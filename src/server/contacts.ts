"use server"

import { db } from "@/db/drizzle"
import {
  contact,
  client,
  source,
  sourceItem,
  user,
  type EntityStatus,
} from "@/db/schema"
import { and, eq, desc, isNull, or, sql, inArray } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { isAutomatedEmail } from "@/lib/is-automated-email"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
  isFreemailDomain,
} from "@/lib/email-domain"
import { randomUUID } from "crypto"

export type ContactRow = {
  id: string
  name: string
  phone: string | null
  email: string | null
  position: string | null
  clientId: string | null
  clientName: string | null
  status: EntityStatus
  userId: string
  userName: string | null
  organizationId: string
  createdAt: string
  updatedAt: string
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertContactInOrg(contactId: string, organizationId: string) {
  const existing = await db
    .select()
    .from(contact)
    .where(eq(contact.id, contactId))
    .limit(1)
  const current = existing[0]
  if (!current) throw new Error("Contact not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

async function assertClientIfProvided(
  clientId: string | null | undefined,
  organizationId: string,
) {
  if (!clientId) return
  const existing = await db
    .select()
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const current = existing[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid client")
  }
}

export async function listContacts(): Promise<ContactRow[]> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await db
    .select({
      contact,
      userName: user.name,
      clientName: client.name,
    })
    .from(contact)
    .leftJoin(user, eq(contact.userId, user.id))
    .leftJoin(client, eq(contact.clientId, client.id))
    .where(eq(contact.organizationId, activeOrgId))
    .orderBy(desc(contact.updatedAt))

  return rows.map((r) => ({
    id: r.contact.id,
    name: r.contact.name,
    phone: r.contact.phone,
    email: r.contact.email,
    position: r.contact.position,
    clientId: r.contact.clientId,
    clientName: r.clientName,
    status: r.contact.status,
    userId: r.contact.userId,
    userName: r.userName,
    organizationId: r.contact.organizationId,
    createdAt: r.contact.createdAt.toISOString(),
    updatedAt: r.contact.updatedAt.toISOString(),
  }))
}

export type ClientOption = { id: string; name: string }

export async function listClientOptions(): Promise<ClientOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        eq(client.status, "active"),
      ),
    )
    .orderBy(client.name)
  return rows
}

export async function createContact(data: {
  name: string
  phone?: string | null
  email?: string | null
  position?: string | null
  clientId?: string | null
  status?: EntityStatus
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.name?.trim()) throw new Error("Name is required")

  await assertClientIfProvided(data.clientId, activeOrgId)

  const id = randomUUID()
  const now = new Date()
  await db.insert(contact).values({
    id,
    name: data.name.trim(),
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    position: data.position?.trim() || null,
    clientId: data.clientId || null,
    status: data.status ?? "active",
    userId: session.user.id,
    organizationId: activeOrgId,
    createdAt: now,
    updatedAt: now,
  })
  return { id }
}

export async function updateContact(
  contactId: string,
  data: {
    name?: string
    phone?: string | null
    email?: string | null
    position?: string | null
    clientId?: string | null
    status?: EntityStatus
  },
) {
  const { activeOrgId } = await requireOrgContext()
  await assertContactInOrg(contactId, activeOrgId)

  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name is required")
  }
  if (data.clientId !== undefined) {
    await assertClientIfProvided(data.clientId, activeOrgId)
  }

  await db
    .update(contact)
    .set({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.phone !== undefined
        ? { phone: data.phone?.trim() || null }
        : {}),
      ...(data.email !== undefined
        ? { email: data.email?.trim() || null }
        : {}),
      ...(data.position !== undefined
        ? { position: data.position?.trim() || null }
        : {}),
      ...(data.clientId !== undefined
        ? { clientId: data.clientId || null }
        : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    })
    .where(eq(contact.id, contactId))
}

// ── Contact discovery from source_item.metadata_json (Nylas only) ────

/**
 * v1 only scans Nylas (email) source_items because they're the only
 * provider whose metadata_json carries structured `{email, name}`
 * participant pairs. See PHASE2.md item 14 for the deferred work to
 * extend this to Chat / Drive / WhatsApp.
 */

type NylasParticipant = {
  email?: unknown
  name?: unknown
}

function isParticipantArray(v: unknown): v is NylasParticipant[] {
  return Array.isArray(v)
}

export type DiscoveredContact = {
  /** First-non-empty name seen, OR the longest non-empty across rows. */
  displayName: string
  /** Lowercased + trimmed email — also acts as the dedup key. */
  email: string
  /** How many source_items contain this email across from/to/cc/bcc. */
  occurrences: number
  /** Sample (capped) source_item ids for context in the preview. */
  sampleSourceItemIds: string[]
}

export type ContactDiscoveryPreview = {
  scannedRowCount: number
  /**
   * Every source_item id that was inspected this run. Stamped at apply
   * time regardless of whether each row contributed a candidate — this
   * stops rows where every participant is already a known contact (or
   * filtered as automated) from being re-scanned forever.
   */
  scannedRowIds: string[]
  candidates: DiscoveredContact[]
}

export async function discoverContacts(): Promise<ContactDiscoveryPreview> {
  const { activeOrgId } = await requireOrgContext()

  // Only Nylas-provider rows that haven't been scanned (or have been
  // re-parsed since their last scan). Joining to `source` to filter by
  // provider — the column lives there, not on source_item.
  const rows = await db
    .select({
      id: sourceItem.id,
      metadataJson: sourceItem.metadataJson,
    })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        eq(sourceItem.organizationId, activeOrgId),
        eq(source.provider, "nylas"),
        eq(sourceItem.parseStatus, "complete"),
        or(
          isNull(sourceItem.contactDiscoveryScannedAt),
          sql`${sourceItem.parsedAt} > ${sourceItem.contactDiscoveryScannedAt}`,
        ),
      ),
    )

  // Existing contacts in the org — used to filter out already-known
  // emails. Match by lowercased trimmed email.
  const existingContacts = await db
    .select({ email: contact.email })
    .from(contact)
    .where(eq(contact.organizationId, activeOrgId))
  const existingEmails = new Set(
    existingContacts
      .map((c) => (c.email ?? "").trim().toLowerCase())
      .filter((e) => e.length > 0),
  )

  // Aggregate participants across the scanned rows.
  type Bucket = {
    email: string
    bestName: string
    sourceItemIds: Set<string>
  }
  const buckets = new Map<string, Bucket>()

  const scannedRowIds: string[] = []

  for (const row of rows) {
    scannedRowIds.push(row.id)
    const meta = (row.metadataJson as Record<string, unknown> | null) ?? {}
    for (const field of ["from", "to", "cc", "bcc"] as const) {
      const list = meta[field]
      if (!isParticipantArray(list)) continue
      for (const p of list) {
        const rawEmail = typeof p.email === "string" ? p.email.trim() : ""
        if (!rawEmail) continue
        const email = rawEmail.toLowerCase()
        if (isAutomatedEmail(email)) continue
        if (existingEmails.has(email)) continue
        const rawName = typeof p.name === "string" ? p.name.trim() : ""

        const existing = buckets.get(email)
        if (existing) {
          existing.sourceItemIds.add(row.id)
          // Longest non-empty name wins (heuristic: more chars = more
          // complete, e.g. "Alice Smith" beats "Alice S.").
          if (rawName.length > existing.bestName.length) {
            existing.bestName = rawName
          }
        } else {
          buckets.set(email, {
            email,
            bestName: rawName,
            sourceItemIds: new Set([row.id]),
          })
        }
      }
    }
  }

  const candidates: DiscoveredContact[] = Array.from(buckets.values())
    .map((b) => ({
      displayName: b.bestName,
      email: b.email,
      occurrences: b.sourceItemIds.size,
      sampleSourceItemIds: Array.from(b.sourceItemIds).slice(0, 5),
    }))
    .sort(
      (a, b) =>
        b.occurrences - a.occurrences ||
        a.email.localeCompare(b.email),
    )

  return {
    scannedRowCount: rows.length,
    scannedRowIds,
    candidates,
  }
}

export type ApplyContactDiscoveryInput = {
  /** Subset of email keys (lowercased) the user picked. */
  selectedEmails: string[]
  /** Per-candidate display name overrides (key = email, value = name).
   *  Lets the user rename a candidate before saving — defaults to the
   *  preview's displayName when absent. */
  nameOverrides?: Record<string, string>
  /** Full candidate set returned by discoverContacts() — for display
   *  name resolution at apply time. */
  candidates: DiscoveredContact[]
  /** scannedRowIds from the preview — stamped on apply regardless of
   *  per-candidate selection so empty-yield rows aren't re-scanned. */
  scannedRowIds: string[]
}

export type ApplyContactDiscoveryResult = {
  createdCount: number
  createdContacts: { id: string; name: string; email: string }[]
  scannedRowsStamped: number
}

export async function applyDiscoveredContacts(
  input: ApplyContactDiscoveryInput,
): Promise<ApplyContactDiscoveryResult> {
  const { session, activeOrgId } = await requireOrgContext()

  // Re-check vs current contacts in case a parallel session created some.
  const existingContacts = await db
    .select({ email: contact.email })
    .from(contact)
    .where(eq(contact.organizationId, activeOrgId))
  const existingEmails = new Set(
    existingContacts
      .map((c) => (c.email ?? "").trim().toLowerCase())
      .filter((e) => e.length > 0),
  )

  const selectedSet = new Set(
    input.selectedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean),
  )
  const overrides = input.nameOverrides ?? {}
  const toCreate = input.candidates.filter(
    (c) => selectedSet.has(c.email) && !existingEmails.has(c.email),
  )

  const createdContacts: { id: string; name: string; email: string }[] = []
  if (toCreate.length > 0) {
    const now = new Date()
    const rows = toCreate.map((c) => {
      // Name precedence: explicit override > discovered displayName >
      // "(unknown)" — never persist an empty `name` since the column
      // is notNull and the existing UI assumes a non-empty label.
      const overridden = (overrides[c.email] ?? "").trim()
      const fallback = c.displayName.trim() || "(unknown)"
      const name = overridden || fallback
      return {
        id: randomUUID(),
        name,
        email: c.email,
        phone: null,
        position: null,
        clientId: null,
        status: "initial" as const,
        userId: session.user.id,
        organizationId: activeOrgId,
        createdAt: now,
        updatedAt: now,
      }
    })
    await db.insert(contact).values(rows)
    for (const r of rows) {
      createdContacts.push({ id: r.id, name: r.name, email: r.email ?? "" })
    }
  }

  // Stamp every scanned row regardless of selection — empty-yield rows
  // would otherwise be re-scanned forever.
  let scannedRowsStamped = 0
  if (input.scannedRowIds.length > 0) {
    await db
      .update(sourceItem)
      .set({ contactDiscoveryScannedAt: new Date() })
      .where(
        and(
          eq(sourceItem.organizationId, activeOrgId),
          inArray(sourceItem.id, input.scannedRowIds),
        ),
      )
    scannedRowsStamped = input.scannedRowIds.length
  }

  return {
    createdCount: createdContacts.length,
    createdContacts,
    scannedRowsStamped,
  }
}

// ── Link Contacts to Clients (by email-domain ↔ webUrl-domain) ───────

export type ContactLinkProposal = {
  contactId: string
  contactName: string
  contactEmail: string
  contactDomain: string
  clientId: string
  clientName: string
  clientWebUrl: string
  clientDomain: string
  /** True when this contact's domain matched 2+ eligible clients. We
   *  picked the alphabetically-first client by name; UI surfaces a
   *  warning chip so the operator can adjust if A picked wrong. */
  ambiguous: boolean
}

export type ContactLinkPreview = {
  /** All contacts considered for matching (active+initial, unlinked,
   *  with non-empty + non-freemail email). Useful for the "scanned X
   *  contacts" summary in the UI. */
  scannedContactCount: number
  proposals: ContactLinkProposal[]
}

/**
 * Build the proposal set: each unlinked, non-suspended contact whose
 * email domain matches the website-domain of an eligible (non-suspended)
 * client. Subdomain-tolerant (see `domainMatches`). Free-mail addresses
 * (gmail.com / yahoo.com / etc.) are excluded — see
 * `src/lib/email-domain.ts` for the full list.
 */
export async function previewContactClientLinks(): Promise<ContactLinkPreview> {
  const { activeOrgId } = await requireOrgContext()

  // Unlinked contacts in the active org, status active or initial,
  // with a non-empty email address.
  const unlinkedContacts = await db
    .select({
      id: contact.id,
      name: contact.name,
      email: contact.email,
    })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, activeOrgId),
        isNull(contact.clientId),
        inArray(contact.status, ["active", "initial"]),
      ),
    )

  // Eligible clients: status active or initial, non-empty webUrl.
  const eligibleClients = await db
    .select({
      id: client.id,
      name: client.name,
      webUrl: client.webUrl,
    })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        inArray(client.status, ["active", "initial"]),
      ),
    )

  // Pre-compute (clientDomain → [client]) so we don't re-extract per
  // contact. Multiple clients can share a domain; ambiguity is flagged
  // at proposal time. Sorted by name within each bucket so "first
  // alphabetical" tie-break is deterministic.
  type ClientWithDomain = {
    id: string
    name: string
    webUrl: string
    domain: string
  }
  const clientsByDomain = new Map<string, ClientWithDomain[]>()
  for (const c of eligibleClients) {
    const url = (c.webUrl ?? "").trim()
    if (!url) continue
    const domain = extractWebsiteDomain(url)
    if (!domain) continue
    const arr = clientsByDomain.get(domain) ?? []
    arr.push({ id: c.id, name: c.name, webUrl: url, domain })
    clientsByDomain.set(domain, arr)
  }
  for (const arr of clientsByDomain.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name))
  }

  let scannedContactCount = 0
  const proposals: ContactLinkProposal[] = []

  for (const c of unlinkedContacts) {
    const email = (c.email ?? "").trim()
    if (!email) continue
    const emailDomain = extractEmailDomain(email)
    if (!emailDomain || isFreemailDomain(emailDomain)) continue
    scannedContactCount++

    // Collect every client whose registered domain is equal-or-suffix
    // of the email domain. Subdomain-tolerant via `domainMatches`.
    const matches: ClientWithDomain[] = []
    for (const [, clients] of clientsByDomain) {
      const first = clients[0]
      if (domainMatches(emailDomain, first.domain)) {
        matches.push(...clients)
      }
    }
    if (matches.length === 0) continue

    matches.sort((a, b) => a.name.localeCompare(b.name))
    const picked = matches[0]
    proposals.push({
      contactId: c.id,
      contactName: c.name,
      contactEmail: email,
      contactDomain: emailDomain,
      clientId: picked.id,
      clientName: picked.name,
      clientWebUrl: picked.webUrl,
      clientDomain: picked.domain,
      ambiguous: matches.length > 1,
    })
  }

  // Sort proposals by contact name for a stable preview.
  proposals.sort((a, b) => a.contactName.localeCompare(b.contactName))

  return { scannedContactCount, proposals }
}

export type ApplyContactClientLinksInput = {
  /** Subset of (contactId, clientId) pairs the user picked. */
  links: { contactId: string; clientId: string }[]
}

export type ApplyContactClientLinksResult = {
  linkedCount: number
}

/**
 * Apply a user-edited link preview. Each pair flips
 * `contact.client_id` from null → clientId. Re-validates org scope and
 * the unlinked-contact precondition before writing — never trusts the
 * client-side payload.
 */
export async function applyContactClientLinks(
  input: ApplyContactClientLinksInput,
): Promise<ApplyContactClientLinksResult> {
  const { activeOrgId } = await requireOrgContext()
  if (input.links.length === 0) return { linkedCount: 0 }

  const contactIds = Array.from(new Set(input.links.map((l) => l.contactId)))
  const clientIds = Array.from(new Set(input.links.map((l) => l.clientId)))

  // Re-validate every contact: must be in the org, currently unlinked.
  // Anything else (e.g. a parallel session linked it) is silently dropped.
  const validContacts = await db
    .select({ id: contact.id, clientId: contact.clientId })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, activeOrgId),
        inArray(contact.id, contactIds),
      ),
    )
  const validUnlinkedContactIds = new Set(
    validContacts.filter((c) => c.clientId === null).map((c) => c.id),
  )

  // Re-validate every client: must be in the org. Status check skipped
  // here — we only block at preview time. If a client became suspended
  // between preview and apply, allow the link (the operator decides).
  const validClients = await db
    .select({ id: client.id })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        inArray(client.id, clientIds),
      ),
    )
  const validClientIds = new Set(validClients.map((c) => c.id))

  let linkedCount = 0
  // Apply per pair. If the user accidentally picked two clients for the
  // same contact, last-write-wins via SQL. The UI keeps it to one pair
  // per contact in v1, so this is defensive only.
  for (const { contactId, clientId } of input.links) {
    if (!validUnlinkedContactIds.has(contactId)) continue
    if (!validClientIds.has(clientId)) continue
    await db
      .update(contact)
      .set({ clientId })
      .where(eq(contact.id, contactId))
    linkedCount++
  }

  return { linkedCount }
}
