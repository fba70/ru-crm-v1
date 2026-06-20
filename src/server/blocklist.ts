// Discovery blocklist — the authoritative org-scoped dictionary that suppresses
// business-irrelevant entities (companies / people / domains / emails) BEFORE
// discovery materialises a client/contact, and classifies blocked senders as
// external. See refs/blocklist.md.
//
// IMPORTANT: `import "server-only"`, NOT `"use server"`. This module exports an
// error class + sync helpers (normalise, the guard) consumed by other server
// modules (discovery) — `"use server"` would restrict exports to async
// functions only and the build would fail.
import "server-only"

import { randomUUID } from "crypto"
import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
  discoveryBlocklist,
  member,
  type BlocklistKind,
} from "@/db/schema"
import { getServerSession } from "@/lib/get-session"
import { companyMatchKey, personMatchKey } from "@/lib/translit-ru"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
} from "@/lib/email-domain"

export class BlocklistError extends Error {
  constructor(
    public readonly reason:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "bad_request",
    message: string,
  ) {
    super(message)
    this.name = "BlocklistError"
  }
}

// ── Auth ──────────────────────────────────────────────────────────────

// Any active member may READ the blocklist.
async function requireMemberOrg(): Promise<string> {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    throw new BlocklistError("unauthorized", "Unauthorized")
  }
  return activeOrgId
}

// Only the org OWNER may MUTATE the blocklist (mirrors the Sources owner gate).
async function requireOwnerOrg(): Promise<{ orgId: string; userId: string }> {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    throw new BlocklistError("unauthorized", "Unauthorized")
  }
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, activeOrgId),
      ),
    )
    .limit(1)
  if (rows[0]?.role !== "owner") {
    throw new BlocklistError(
      "forbidden",
      "Только владелец организации может управлять списком блокировки",
    )
  }
  return { orgId: activeOrgId, userId: session.user.id }
}

// ── Normalisation (§2.1) ──────────────────────────────────────────────

// Map a raw operator-entered value to its canonical match key + display label,
// or null when the value is malformed for the kind. Storing the canonical form
// is what makes "ООО АСТ" / "AST" / "АСТ" collapse to one entry.
export function normaliseBlocklistValue(
  kind: BlocklistKind,
  rawValue: string,
): { matchKey: string; label: string } | null {
  const label = (rawValue ?? "").trim()
  if (!label) return null

  if (kind === "email") {
    const e = label.toLowerCase()
    if (!e.includes("@")) return null
    return { matchKey: e, label }
  }
  if (kind === "domain") {
    // Accept "user@host", "https://host/path", "www.host" → bare host.
    let v = label
    const at = v.lastIndexOf("@")
    if (at >= 0) v = v.slice(at + 1)
    const host = extractWebsiteDomain(v)
    if (!host || !host.includes(".")) return null
    return { matchKey: host, label }
  }
  if (kind === "company") {
    const key = companyMatchKey(label)
    if (!key) return null
    return { matchKey: key, label }
  }
  // person
  const key = personMatchKey(label)
  if (!key) return null
  return { matchKey: key, label }
}

// ── The memoized read guard (§2.2) — mirror of loadOwnOrgIdentity ─────

export type OrgBlocklist = {
  isBlockedEmail: (email: string) => boolean
  isBlockedDomain: (domain: string) => boolean
  isBlockedCompanyKey: (key: string) => boolean
  isBlockedPersonKey: (key: string) => boolean
  hasEntries: boolean
}

type Snapshot = {
  emails: Set<string>
  domains: string[]
  companyKeys: Set<string>
  personKeys: Set<string>
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { snap: Snapshot; expires: number }>()

// MUST be called on every mutation, or the 5-min cache serves stale predicates
// to discovery until TTL.
export function invalidateOrgBlocklist(orgId: string): void {
  cache.delete(orgId)
}

function emptySnapshot(): Snapshot {
  return {
    emails: new Set(),
    domains: [],
    companyKeys: new Set(),
    personKeys: new Set(),
  }
}

function buildGuard(snap: Snapshot): OrgBlocklist {
  const isBlockedDomain = (domain: string): boolean => {
    const d = (domain ?? "").trim().toLowerCase()
    if (!d) return false
    for (const bd of snap.domains) {
      // Subdomain-aware, both directions: a blocked "acme.com" matches
      // "mail.acme.com", and a blocked "mail.acme.com" is covered by "acme.com".
      if (d === bd || domainMatches(d, bd) || domainMatches(bd, d)) return true
    }
    return false
  }
  return {
    hasEntries:
      snap.emails.size > 0 ||
      snap.domains.length > 0 ||
      snap.companyKeys.size > 0 ||
      snap.personKeys.size > 0,
    isBlockedDomain,
    // Blocking a domain auto-blocks all its mailboxes.
    isBlockedEmail: (email: string) => {
      const e = (email ?? "").trim().toLowerCase()
      if (!e) return false
      if (snap.emails.has(e)) return true
      return isBlockedDomain(extractEmailDomain(e))
    },
    isBlockedCompanyKey: (key: string) => !!key && snap.companyKeys.has(key),
    isBlockedPersonKey: (key: string) => !!key && snap.personKeys.has(key),
  }
}

// Inert (all-false) when the org has no entries → callers are unchanged.
export async function loadOrgBlocklist(
  orgId: string | null,
): Promise<OrgBlocklist> {
  if (!orgId) return buildGuard(emptySnapshot())

  const now = Date.now()
  const cached = cache.get(orgId)
  if (cached && cached.expires > now) return buildGuard(cached.snap)

  const rows = await db
    .select({
      kind: discoveryBlocklist.kind,
      matchKey: discoveryBlocklist.matchKey,
    })
    .from(discoveryBlocklist)
    .where(eq(discoveryBlocklist.organizationId, orgId))

  const snap = emptySnapshot()
  for (const r of rows) {
    if (r.kind === "email") snap.emails.add(r.matchKey)
    else if (r.kind === "domain") snap.domains.push(r.matchKey)
    else if (r.kind === "company") snap.companyKeys.add(r.matchKey)
    else if (r.kind === "person") snap.personKeys.add(r.matchKey)
  }
  cache.set(orgId, { snap, expires: now + CACHE_TTL_MS })
  return buildGuard(snap)
}

// ── CRUD (§2.3) ───────────────────────────────────────────────────────

export type BlocklistEntry = {
  id: string
  kind: BlocklistKind
  matchKey: string
  label: string
  note: string | null
  sourceItemId: string | null
  createdAt: string
}

// Readable by any member.
export async function listBlocklist(): Promise<BlocklistEntry[]> {
  const orgId = await requireMemberOrg()
  const rows = await db
    .select()
    .from(discoveryBlocklist)
    .where(eq(discoveryBlocklist.organizationId, orgId))
    .orderBy(desc(discoveryBlocklist.createdAt))
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    matchKey: r.matchKey,
    label: r.label,
    note: r.note,
    sourceItemId: r.sourceItemId,
    createdAt: r.createdAt.toISOString(),
  }))
}

// True when the caller may manage the blocklist (drives best-effort UI gating;
// the mutations are the real gate). Never throws.
export async function canManageBlocklist(): Promise<boolean> {
  try {
    await requireOwnerOrg()
    return true
  } catch {
    return false
  }
}

export type SweepResult = { sweptClients: number; sweptContacts: number }
export type AddBlocklistResult = SweepResult & { added: number }

type DerivedEntry = {
  kind: BlocklistKind
  value: string
  note?: string | null
  sourceItemId?: string | null
}

// Shared insert+sweep core for both the manual add and the from-entity path.
async function insertAndSweep(
  orgId: string,
  userId: string,
  entries: DerivedEntry[],
): Promise<AddBlocklistResult> {
  let added = 0
  let sweptClients = 0
  let sweptContacts = 0

  for (const e of entries) {
    const norm = normaliseBlocklistValue(e.kind, e.value)
    if (!norm) continue
    const inserted = await db
      .insert(discoveryBlocklist)
      .values({
        id: randomUUID(),
        organizationId: orgId,
        kind: e.kind,
        matchKey: norm.matchKey,
        label: norm.label,
        note: (e.note ?? "").trim() || null,
        sourceItemId: e.sourceItemId ?? null,
        createdByUserId: userId,
      })
      .onConflictDoNothing()
      .returning({ id: discoveryBlocklist.id })
    if (inserted.length > 0) added++

    // Sweep runs regardless of whether the row was newly inserted — re-running
    // a block should still hide rows that materialised since the first add.
    const swept = await sweepExisting(orgId, e.kind, norm.matchKey)
    sweptClients += swept.sweptClients
    sweptContacts += swept.sweptContacts
  }

  invalidateOrgBlocklist(orgId)
  return { added, sweptClients, sweptContacts }
}

export async function addBlocklistEntry(input: {
  kind: BlocklistKind
  value: string
  note?: string | null
  sourceItemId?: string | null
}): Promise<AddBlocklistResult> {
  const { orgId, userId } = await requireOwnerOrg()
  if (!normaliseBlocklistValue(input.kind, input.value)) {
    throw new BlocklistError(
      "bad_request",
      "Некорректное значение для выбранного типа",
    )
  }
  return insertAndSweep(orgId, userId, [input])
}

export async function removeBlocklistEntry(id: string): Promise<void> {
  const { orgId } = await requireOwnerOrg()
  const res = await db
    .delete(discoveryBlocklist)
    .where(
      and(
        eq(discoveryBlocklist.id, id),
        eq(discoveryBlocklist.organizationId, orgId),
      ),
    )
    .returning({ id: discoveryBlocklist.id })
  if (res.length === 0) {
    throw new BlocklistError("not_found", "Запись не найдена")
  }
  invalidateOrgBlocklist(orgId)
}

// Derive blocklist entries from an existing row + persist + sweep (which also
// flips the row itself to `blocked`, since the derived entries match it).
//  - client  → company(name) [+ domain(webUrl host) if any]
//  - contact → email(if present) else person(name)
export async function blacklistEntity(input: {
  entityType: "client" | "contact"
  id: string
}): Promise<AddBlocklistResult> {
  const { orgId, userId } = await requireOwnerOrg()

  const entries: DerivedEntry[] = []
  if (input.entityType === "client") {
    const rows = await db
      .select({ name: client.name, webUrl: client.webUrl })
      .from(client)
      .where(and(eq(client.id, input.id), eq(client.organizationId, orgId)))
      .limit(1)
    const row = rows[0]
    if (!row) throw new BlocklistError("not_found", "Клиент не найден")
    entries.push({ kind: "company", value: row.name })
    const domain = row.webUrl ? extractWebsiteDomain(row.webUrl) : ""
    if (domain && domain.includes(".")) {
      entries.push({ kind: "domain", value: domain })
    }
  } else {
    const rows = await db
      .select({ name: contact.name, email: contact.email })
      .from(contact)
      .where(and(eq(contact.id, input.id), eq(contact.organizationId, orgId)))
      .limit(1)
    const row = rows[0]
    if (!row) throw new BlocklistError("not_found", "Контакт не найден")
    const email = (row.email ?? "").trim()
    if (email) entries.push({ kind: "email", value: email })
    else entries.push({ kind: "person", value: row.name })
  }

  return insertAndSweep(orgId, userId, entries)
}

// ── Retroactive sweep (§2.5) ──────────────────────────────────────────
// Company/person/domain matching needs the JS key helpers, so fetch the org's
// candidate rows and filter in-process (org-scoped, bounded), then bulk-update.

const SWEEPABLE = (status: string) => status !== "blocked" && status !== "deleted"

async function sweepExisting(
  orgId: string,
  kind: BlocklistKind,
  matchKey: string,
): Promise<SweepResult> {
  let sweptClients = 0
  let sweptContacts = 0

  const blockClients = async (ids: string[]) => {
    if (ids.length === 0) return
    await db
      .update(client)
      .set({ status: "blocked" })
      .where(and(eq(client.organizationId, orgId), inArray(client.id, ids)))
    sweptClients += ids.length
  }
  const blockContacts = async (ids: string[]) => {
    if (ids.length === 0) return
    await db
      .update(contact)
      .set({ status: "blocked" })
      .where(and(eq(contact.organizationId, orgId), inArray(contact.id, ids)))
    sweptContacts += ids.length
  }

  const domainMatchesKey = (d: string) =>
    !!d &&
    (d === matchKey || domainMatches(d, matchKey) || domainMatches(matchKey, d))

  if (kind === "company") {
    const rows = await db
      .select({
        id: client.id,
        name: client.name,
        aliases: client.aliases,
        status: client.status,
      })
      .from(client)
      .where(eq(client.organizationId, orgId))
    const ids = rows
      .filter((c) => SWEEPABLE(c.status))
      .filter(
        (c) =>
          companyMatchKey(c.name) === matchKey ||
          (c.aliases ?? []).some((a) => companyMatchKey(a) === matchKey),
      )
      .map((c) => c.id)
    await blockClients(ids)
  } else if (kind === "domain") {
    const clientRows = await db
      .select({ id: client.id, webUrl: client.webUrl, status: client.status })
      .from(client)
      .where(eq(client.organizationId, orgId))
    await blockClients(
      clientRows
        .filter((c) => SWEEPABLE(c.status))
        .filter((c) =>
          domainMatchesKey(c.webUrl ? extractWebsiteDomain(c.webUrl) : ""),
        )
        .map((c) => c.id),
    )
    const contactRows = await db
      .select({ id: contact.id, email: contact.email, status: contact.status })
      .from(contact)
      .where(eq(contact.organizationId, orgId))
    await blockContacts(
      contactRows
        .filter((c) => SWEEPABLE(c.status))
        .filter((c) =>
          domainMatchesKey(c.email ? extractEmailDomain(c.email) : ""),
        )
        .map((c) => c.id),
    )
  } else if (kind === "email") {
    const contactRows = await db
      .select({ id: contact.id, email: contact.email, status: contact.status })
      .from(contact)
      .where(eq(contact.organizationId, orgId))
    await blockContacts(
      contactRows
        .filter((c) => SWEEPABLE(c.status))
        .filter((c) => (c.email ?? "").trim().toLowerCase() === matchKey)
        .map((c) => c.id),
    )
  } else {
    // person
    const contactRows = await db
      .select({
        id: contact.id,
        name: contact.name,
        nameNative: contact.nameNative,
        aliases: contact.aliases,
        status: contact.status,
      })
      .from(contact)
      .where(eq(contact.organizationId, orgId))
    await blockContacts(
      contactRows
        .filter((c) => SWEEPABLE(c.status))
        .filter((c) =>
          [c.name, c.nameNative, ...(c.aliases ?? [])].some(
            (n) => personMatchKey(n ?? "") === matchKey,
          ),
        )
        .map((c) => c.id),
    )
  }

  return { sweptClients, sweptContacts }
}
