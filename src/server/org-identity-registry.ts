// Own-organisation identity registry — the owner-curated dictionary of extra
// names / synonyms, websites and postal addresses that mean "this is US".
//
// The `organization` profile (name / web_url / address / email) stays the
// PRIMARY identity; this registry is additive, and exists because those columns
// are single-valued: an org that trades as both "АСТ" and "AST INTER", owns two
// domains, or ships from two addresses had no way to say so — and every
// unspoken form leaked into discovery as a brand-new client.
//
// Read path: `loadOwnOrgIdentity` + `getOrgIdentity` (src/server/org-identity.ts).
// Write path: this module, owner-gated, mirroring src/server/blocklist.ts.
//
// IMPORTANT: `import "server-only"`, NOT `"use server"`. This module exports an
// error class + sync helpers alongside async functions; `"use server"` would
// restrict exports to async functions only and the build would fail.
import "server-only"

import { randomUUID } from "crypto"
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
  member,
  orgIdentityEntry,
  type OrgIdentityKind,
} from "@/db/schema"
import { getServerSession } from "@/lib/get-session"
import { companyMatchKey } from "@/lib/translit-ru"
import { addressMatchKey, addressMatchesText } from "@/lib/address-match"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
} from "@/lib/email-domain"
import { invalidateOrgIdentity } from "@/server/org-identity"

export class OrgIdentityError extends Error {
  constructor(
    public readonly reason:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "bad_request",
    message: string,
  ) {
    super(message)
    this.name = "OrgIdentityError"
  }
}

// ── Auth ──────────────────────────────────────────────────────────────

// Any active member may READ the registry (it drives no privileged data).
async function requireMemberOrg(): Promise<string> {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    throw new OrgIdentityError("unauthorized", "Unauthorized")
  }
  return activeOrgId
}

// Only the org OWNER may MUTATE it (mirrors the blocklist / sources gate).
async function requireOwnerOrg(): Promise<{ orgId: string; userId: string }> {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    throw new OrgIdentityError("unauthorized", "Unauthorized")
  }
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, activeOrgId),
        eq(member.userId, session.user.id),
      ),
    )
    .limit(1)
  if (rows[0]?.role !== "owner") {
    throw new OrgIdentityError(
      "forbidden",
      "Только владелец организации может менять реестр",
    )
  }
  return { orgId: activeOrgId, userId: session.user.id }
}

// ── Normalisation ─────────────────────────────────────────────────────

/**
 * Canonical form per kind. Returns null when the value can't produce a usable
 * key (empty, punctuation-only, a bare legal suffix, an unparseable URL, or an
 * address too thin to ever match — see `addressMatchesText`'s 2-token floor).
 *
 * `label` is the raw value as typed, kept for display; `matchKey` is what the
 * guards compare against and what the unique index dedups on.
 */
export function normaliseIdentityValue(
  kind: OrgIdentityKind,
  raw: string,
): { matchKey: string; label: string } | null {
  const label = (raw ?? "").trim()
  if (!label) return null

  if (kind === "name") {
    const key = companyMatchKey(label)
    return key ? { matchKey: key, label } : null
  }
  if (kind === "website") {
    // Accepts a full URL or a bare host; both reduce to the bare host.
    const host = extractWebsiteDomain(label)
    return host ? { matchKey: host, label } : null
  }
  // address
  const key = addressMatchKey(label)
  if (!key) return null
  // An address whose key has fewer than two alphabetic tokens can never match
  // any document (the matcher's floor), so storing it would be a silent no-op.
  const alphaTokens = key.split(" ").filter((t) => t && !/^\d/.test(t))
  if (alphaTokens.length < 2) return null
  return { matchKey: key, label }
}

// ── Read ──────────────────────────────────────────────────────────────

export type OrgIdentityEntryView = {
  id: string
  kind: OrgIdentityKind
  matchKey: string
  label: string
  note: string | null
  createdAt: string
}

export async function listOrgIdentityEntries(): Promise<OrgIdentityEntryView[]> {
  const orgId = await requireMemberOrg()
  const rows = await db
    .select()
    .from(orgIdentityEntry)
    .where(eq(orgIdentityEntry.organizationId, orgId))
    .orderBy(desc(orgIdentityEntry.createdAt))
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    matchKey: r.matchKey,
    label: r.label,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }))
}

// True when the caller may manage the registry (drives best-effort UI gating;
// the mutations are the real gate). Never throws.
export async function canManageOrgIdentity(): Promise<boolean> {
  try {
    await requireOwnerOrg()
    return true
  } catch {
    return false
  }
}

// ── Retroactive matches (report-only, never mutates) ──────────────────

export type IdentityMatch = {
  id: string
  name: string
  detail: string | null
  status: string
}

export type IdentityMatches = {
  clients: IdentityMatch[]
  contacts: IdentityMatch[]
}

/**
 * Existing clients / contacts that this entry says are actually US — i.e. rows
 * discovery should never have created. Deliberately REPORT-ONLY: unlike the
 * blocklist's sweep, nothing is mutated here, because a wrongly-created client
 * may already carry deals or orders. The dialog shows the list and the owner
 * decides row by row (soft-delete via the existing PUT /api/clients).
 *
 * Already soft-deleted rows are omitted — they are out of the way already.
 */
export async function findIdentityMatches(
  orgId: string,
  kind: OrgIdentityKind,
  matchKey: string,
): Promise<IdentityMatches> {
  const out: IdentityMatches = { clients: [], contacts: [] }
  if (!matchKey) return out

  const hidden = (status: string) => status === "deleted"

  if (kind === "name") {
    const rows = await db
      .select({
        id: client.id,
        name: client.name,
        aliases: client.aliases,
        webUrl: client.webUrl,
        status: client.status,
      })
      .from(client)
      .where(eq(client.organizationId, orgId))
    out.clients = rows
      .filter((c) => !hidden(c.status))
      .filter(
        (c) =>
          companyMatchKey(c.name) === matchKey ||
          (c.aliases ?? []).some((a) => companyMatchKey(a) === matchKey),
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        detail: c.webUrl,
        status: c.status,
      }))
    return out
  }

  if (kind === "website") {
    const clientRows = await db
      .select({
        id: client.id,
        name: client.name,
        webUrl: client.webUrl,
        email: client.email,
        status: client.status,
      })
      .from(client)
      .where(eq(client.organizationId, orgId))
    const hostMatches = (d: string) =>
      !!d && (d === matchKey || domainMatches(d, matchKey) || domainMatches(matchKey, d))
    out.clients = clientRows
      .filter((c) => !hidden(c.status))
      .filter(
        (c) =>
          hostMatches(extractWebsiteDomain(c.webUrl ?? "")) ||
          hostMatches(extractEmailDomain(c.email ?? "")),
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        detail: c.webUrl ?? c.email,
        status: c.status,
      }))

    const contactRows = await db
      .select({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        status: contact.status,
      })
      .from(contact)
      .where(eq(contact.organizationId, orgId))
    out.contacts = contactRows
      .filter((c) => !hidden(c.status))
      .filter((c) => hostMatches(extractEmailDomain(c.email ?? "")))
      .map((c) => ({
        id: c.id,
        name: c.name,
        detail: c.email,
        status: c.status,
      }))
    return out
  }

  // address — compare the stored client address through the same token matcher.
  const rows = await db
    .select({
      id: client.id,
      name: client.name,
      address: client.address,
      status: client.status,
    })
    .from(client)
    .where(eq(client.organizationId, orgId))
  out.clients = rows
    .filter((c) => !hidden(c.status))
    .filter((c) => !!c.address && addressMatchesText(matchKey, c.address))
    .map((c) => ({
      id: c.id,
      name: c.name,
      detail: c.address,
      status: c.status,
    }))
  return out
}

// ── Mutations ─────────────────────────────────────────────────────────

export type AddOrgIdentityResult = {
  added: number
  entry: OrgIdentityEntryView | null
  matches: IdentityMatches
}

export async function addOrgIdentityEntry(input: {
  kind: OrgIdentityKind
  value: string
  note?: string | null
}): Promise<AddOrgIdentityResult> {
  const { orgId, userId } = await requireOwnerOrg()
  const norm = normaliseIdentityValue(input.kind, input.value)
  if (!norm) {
    throw new OrgIdentityError(
      "bad_request",
      input.kind === "address"
        ? "Адрес слишком короткий — укажите город и улицу"
        : "Некорректное значение для выбранного типа",
    )
  }

  const inserted = await db
    .insert(orgIdentityEntry)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      kind: input.kind,
      matchKey: norm.matchKey,
      label: norm.label,
      note: (input.note ?? "").trim() || null,
      createdByUserId: userId,
    })
    .onConflictDoNothing()
    .returning()

  // Drop the memoised attribution identity so the very next parse sees it.
  // (`loadOwnOrgIdentity` reads fresh on every call, so discovery needs no
  // invalidation.)
  invalidateOrgIdentity(orgId)

  // Report-only, and computed even when the row already existed — re-adding a
  // synonym is a legitimate way to re-check the blast radius.
  const matches = await findIdentityMatches(orgId, input.kind, norm.matchKey)

  const row = inserted[0]
  return {
    added: row ? 1 : 0,
    entry: row
      ? {
          id: row.id,
          kind: row.kind,
          matchKey: row.matchKey,
          label: row.label,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
        }
      : null,
    matches,
  }
}

export async function removeOrgIdentityEntry(id: string): Promise<void> {
  const { orgId } = await requireOwnerOrg()
  const res = await db
    .delete(orgIdentityEntry)
    .where(
      and(
        eq(orgIdentityEntry.id, id),
        eq(orgIdentityEntry.organizationId, orgId),
      ),
    )
    .returning({ id: orgIdentityEntry.id })
  if (res.length === 0) {
    throw new OrgIdentityError("not_found", "Запись не найдена")
  }
  invalidateOrgIdentity(orgId)
}
