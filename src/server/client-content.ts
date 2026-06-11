// Not "use server" — exports a typed error class alongside async fns.
// `server-only` keeps this module out of the client bundle.
import "server-only"

import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
  deal,
  dealContact,
  source,
  sourceItem,
  user,
  type EntityStatus,
  type FunnelPhase,
} from "@/db/schema"
import {
  mimeBucketClause,
  type SourceItemListResult,
  type StoredContentMimeBucket,
} from "@/server/source-items"
import type { ContactRow } from "@/server/contacts"
import type { ClientCustomFields } from "@/lib/client-custom-fields"

export class ClientContentScopeError extends Error {
  constructor(
    public readonly reason: "not_found" | "forbidden",
    message: string,
  ) {
    super(message)
    this.name = "ClientContentScopeError"
  }
}

// Contact shape mirrors `ContactRow` from `@/server/contacts` so the
// detail page can reuse `ContactEditDialog` without remapping.
export type ClientDetail = {
  id: string
  name: string
  namePhys: string | null
  comment: string | null
  aliases: string[] | null
  phone: string | null
  email: string | null
  address: string | null
  webUrl: string | null
  customFields: ClientCustomFields
  funnelPhase: FunnelPhase
  status: EntityStatus
  userId: string
  userName: string | null
  organizationId: string
  createdAt: string
  updatedAt: string
  contacts: ContactRow[]
}

// Fetches a client + every contact attached to it (active AND
// suspended). The list view (`listClients`) intentionally only joins
// active contacts for the card preview; the detail page wants the full
// roster. Tenant-scoped on `organizationId` — throws `ClientContentScopeError`
// on miss/forbidden so the route layer can pick the right HTTP code.
export async function getClientDetail(
  organizationId: string,
  clientId: string,
): Promise<ClientDetail> {
  const rows = await db
    .select({
      id: client.id,
      name: client.name,
      namePhys: client.namePhys,
      comment: client.comment,
      aliases: client.aliases,
      phone: client.phone,
      email: client.email,
      address: client.address,
      webUrl: client.webUrl,
      customFields: client.customFields,
      funnelPhase: client.funnelPhase,
      status: client.status,
      userId: client.userId,
      organizationId: client.organizationId,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    })
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new ClientContentScopeError("not_found", "Client not found")
  }
  if (row.organizationId !== organizationId) {
    throw new ClientContentScopeError("forbidden", "Client not in scope")
  }

  // Fetch creator name in parallel with contacts. Both are bounded.
  const [contactRows, creatorRows] = await Promise.all([
    db
      .select({
        contact,
        userName: user.name,
      })
      .from(contact)
      .leftJoin(user, eq(contact.userId, user.id))
      .where(
        and(
          eq(contact.organizationId, organizationId),
          eq(contact.clientId, clientId),
          // Soft-deleted contacts stay hidden here too — restore them from
          // the Contacts tab's explicit "deleted" status filter.
          ne(contact.status, "deleted"),
        ),
      )
      .orderBy(desc(contact.updatedAt)),
    db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, row.userId))
      .limit(1),
  ])

  const userName = creatorRows[0]?.name ?? null

  return {
    id: row.id,
    name: row.name,
    namePhys: row.namePhys,
    comment: row.comment,
    aliases: row.aliases,
    phone: row.phone,
    email: row.email,
    address: row.address,
    webUrl: row.webUrl,
    customFields: row.customFields ?? {},
    funnelPhase: row.funnelPhase,
    status: row.status,
    userId: row.userId,
    userName,
    organizationId: row.organizationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    contacts: contactRows.map(({ contact: c, userName: cu }) => ({
      id: c.id,
      name: c.name,
      nameNative: c.nameNative,
      aliases: c.aliases,
      phone: c.phone,
      email: c.email,
      position: c.position,
      clientId: c.clientId,
      clientName: row.name,
      status: c.status,
      userId: c.userId,
      userName: cu,
      organizationId: c.organizationId,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
  }
}

// ── Client-relevant content listing ──────────────────────────────────
//
// Surfaces every R2-uploaded source_item whose `metadata_json` mentions
// any of the client's identifying signals. The matching rule is
// deliberately broad — we treat any hit on any signal as inclusion (OR
// across signals) — and only inspects `metadata_json::text`. Full
// markdown body search comes later when full-text indexing lands.
//
// Signals collected (every non-empty field becomes one ILIKE term):
//   • client.name        — case-insensitive substring; matches `companies[]`,
//                          `mentions[]`, summary text, etc.
//   • client.address     — substring on the metadata text blob
//   • client.webUrl      — host-only after stripping protocol + `www.`
//                          + path; matches `urls[]` and any other
//                          appearance
//   • contact.name       — substring; matches sender/recipient labels
//   • contact.email      — substring; matches sender/recipient values
//                          which encode "Name <email>"
//
// A row is included if ANY term hits (terms are OR'd). Empty fields
// are skipped — they don't act as match-all. Min term length 2 to
// dodge degenerate single-character matches.
//
// Hard pre-filter: `parseStatus = 'complete' AND r2UploadStatus = 'complete'`
// so the table only ever shows rows whose markdown can be fetched from R2.

export type ClientContentFilters = {
  organizationId: string
  clientId: string
  sourceId?: string
  mimeBucket?: StoredContentMimeBucket
  // Free-text refinement on top of the relevance clause. Searches
  // filename + metadata_json::text. AND'd with the client signals so
  // it narrows further, never expands.
  q?: string
  dateFrom?: Date
  dateTo?: Date
  limit?: number
  offset?: number
}

export type ClientContentResult = SourceItemListResult & {
  matchTerms: string[]
}

const MIN_TERM_LENGTH = 2

function normalizeWebsite(url: string | null): string | null {
  if (!url) return null
  let raw = url.trim()
  if (!raw) return null
  raw = raw.replace(/^[a-z][a-z0-9+\-.]*:\/\//i, "")
  raw = raw.replace(/^www\./i, "")
  raw = raw.split("/")[0].split("?")[0].split("#")[0]
  return raw.toLowerCase() || null
}

// Adds a single non-empty, ≥MIN_TERM_LENGTH term to the set (lowercased,
// trimmed). Shared by the client / contact / deal term builders.
function addTerm(terms: Set<string>, raw: string | null | undefined) {
  if (!raw) return
  const lower = raw.trim().toLowerCase()
  if (lower.length < MIN_TERM_LENGTH) return
  terms.add(lower)
}

// Best-effort: appends a client's identifying terms (name, address,
// host-only website, plus every non-deleted contact's name + email) into
// `terms`. No scope throw — callers that need the not_found/forbidden
// distinction (listClientContent) check it themselves first. Used by both
// the client and deal content matchers so a deal inherits its client's
// relevance signals.
async function addClientTerms(
  organizationId: string,
  clientId: string,
  terms: Set<string>,
) {
  const clientRows = await db
    .select({
      name: client.name,
      address: client.address,
      webUrl: client.webUrl,
      organizationId: client.organizationId,
    })
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)

  const c = clientRows[0]
  if (!c || c.organizationId !== organizationId) return

  addTerm(terms, c.name)
  addTerm(terms, c.address)
  addTerm(terms, normalizeWebsite(c.webUrl))

  const contactRows = await db
    .select({ name: contact.name, email: contact.email })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.clientId, clientId),
        ne(contact.status, "deleted"),
      ),
    )
  for (const r of contactRows) {
    addTerm(terms, r.name)
    addTerm(terms, r.email)
  }
}

// Core relevance matcher: given a ready-made `matchTerms[]`, returns every
// R2-uploaded source_item in the org whose `metadata_json::text` matches any
// term (OR), narrowed by the optional source/mime/q/date filters (AND). Shared
// by the client / contact / deal content listings — they differ only in how
// they build the term set. Empty term set → empty result (never match-all).
type ContentByTermsFilters = {
  organizationId: string
  matchTerms: string[]
  sourceId?: string
  mimeBucket?: StoredContentMimeBucket
  q?: string
  dateFrom?: Date
  dateTo?: Date
  limit?: number
  offset?: number
}

async function listContentByTerms(
  filters: ContentByTermsFilters,
): Promise<SourceItemListResult> {
  const limit = Math.min(filters.limit ?? 5, 100)
  const offset = Math.max(filters.offset ?? 0, 0)

  if (filters.matchTerms.length === 0) {
    return { rows: [], total: 0 }
  }

  const relevanceClause = or(
    ...filters.matchTerms.map(
      (t) => sql`${sourceItem.metadataJson}::text ILIKE ${`%${t}%`}`,
    ),
  )

  const where = and(
    eq(sourceItem.organizationId, filters.organizationId),
    eq(sourceItem.parseStatus, "complete"),
    eq(sourceItem.r2UploadStatus, "complete"),
    relevanceClause,
    filters.sourceId ? eq(sourceItem.sourceId, filters.sourceId) : undefined,
    mimeBucketClause(filters.mimeBucket),
    filters.q && filters.q.trim().length > 0
      ? or(
          ilike(sourceItem.filename, `%${filters.q.trim()}%`),
          sql`${sourceItem.metadataJson}::text ILIKE ${`%${filters.q.trim()}%`}`,
        )
      : undefined,
    filters.dateFrom
      ? gte(sourceItem.sourceCreatedAt, filters.dateFrom)
      : undefined,
    filters.dateTo ? lte(sourceItem.sourceCreatedAt, filters.dateTo) : undefined,
  )

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: sourceItem.id,
        sourceId: sourceItem.sourceId,
        sourceName: source.name,
        sourceProvider: source.provider,
        externalId: sourceItem.externalId,
        externalType: sourceItem.externalType,
        externalUrl: sourceItem.externalUrl,
        parentSourceItemId: sourceItem.parentSourceItemId,
        filename: sourceItem.filename,
        mimeType: sourceItem.mimeType,
        sizeBytes: sourceItem.sizeBytes,
        threadExternalId: sourceItem.threadExternalId,
        metadataJson: sourceItem.metadataJson,
        sourceCreatedAt: sourceItem.sourceCreatedAt,
        fetchedAt: sourceItem.fetchedAt,
        parseStatus: sourceItem.parseStatus,
        parsedAt: sourceItem.parsedAt,
        parseError: sourceItem.parseError,
        parserModel: sourceItem.parserModel,
        r2UploadStatus: sourceItem.r2UploadStatus,
        r2UploadedAt: sourceItem.r2UploadedAt,
        markdownR2Key: sourceItem.markdownR2Key,
        markdownR2SizeBytes: sourceItem.markdownR2SizeBytes,
      })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(where)
      .orderBy(desc(sourceItem.sourceCreatedAt), desc(sourceItem.fetchedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ n: count() })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(where),
  ])

  return {
    rows: rows.map((r) => ({
      ...r,
      metadataJson: (r.metadataJson as Record<string, unknown> | null) ?? {},
    })),
    total: totalRows[0]?.n ?? 0,
  }
}

export async function listClientContent(
  filters: ClientContentFilters,
): Promise<ClientContentResult> {
  // Scope-check the client up front so the route can distinguish
  // not_found vs forbidden (the term-builder below is best-effort).
  const clientRows = await db
    .select({ organizationId: client.organizationId })
    .from(client)
    .where(eq(client.id, filters.clientId))
    .limit(1)

  const c = clientRows[0]
  if (!c) {
    throw new ClientContentScopeError("not_found", "Client not found")
  }
  if (c.organizationId !== filters.organizationId) {
    throw new ClientContentScopeError("forbidden", "Client not in scope")
  }

  const terms = new Set<string>()
  await addClientTerms(filters.organizationId, filters.clientId, terms)
  const matchTerms = Array.from(terms)

  // No usable signals → empty result. The page UI surfaces this as
  // "No identifying fields on this client yet — add an email, website,
  // or contact to start matching content."
  if (matchTerms.length === 0) {
    return { rows: [], total: 0, matchTerms: [] }
  }

  const result = await listContentByTerms({ ...filters, matchTerms })
  return { ...result, matchTerms }
}

// ── Contact-relevant content listing ─────────────────────────────────
//
// Same broad relevance heuristic as `listClientContent`, but the term set
// is built from the contact's own identifying fields: technical name,
// native-language name, email, and phone. Tenant-scoped on `organizationId`.

export type ContactContentFilters = {
  organizationId: string
  contactId: string
  sourceId?: string
  mimeBucket?: StoredContentMimeBucket
  q?: string
  dateFrom?: Date
  dateTo?: Date
  limit?: number
  offset?: number
}

export async function listContactContent(
  filters: ContactContentFilters,
): Promise<ClientContentResult> {
  const rows = await db
    .select({
      name: contact.name,
      nameNative: contact.nameNative,
      email: contact.email,
      phone: contact.phone,
      organizationId: contact.organizationId,
    })
    .from(contact)
    .where(eq(contact.id, filters.contactId))
    .limit(1)

  const ct = rows[0]
  if (!ct) {
    throw new ClientContentScopeError("not_found", "Contact not found")
  }
  if (ct.organizationId !== filters.organizationId) {
    throw new ClientContentScopeError("forbidden", "Contact not in scope")
  }

  const terms = new Set<string>()
  addTerm(terms, ct.name)
  addTerm(terms, ct.nameNative)
  addTerm(terms, ct.email)
  addTerm(terms, ct.phone)
  const matchTerms = Array.from(terms)

  if (matchTerms.length === 0) {
    return { rows: [], total: 0, matchTerms: [] }
  }

  const result = await listContentByTerms({ ...filters, matchTerms })
  return { ...result, matchTerms }
}

// ── Deal-relevant content listing ────────────────────────────────────
//
// A deal's content is its parent client's relevant content, broadened with
// the deal's own name and its linked contacts. Term set = deal.name +
// addClientTerms(deal.clientId) + each linked contact's name/email/native
// name/phone. Tenant-scoped on `organizationId`.

export type DealContentFilters = {
  organizationId: string
  dealId: string
  sourceId?: string
  mimeBucket?: StoredContentMimeBucket
  q?: string
  dateFrom?: Date
  dateTo?: Date
  limit?: number
  offset?: number
}

export async function listDealContent(
  filters: DealContentFilters,
): Promise<ClientContentResult> {
  const rows = await db
    .select({
      name: deal.name,
      clientId: deal.clientId,
      organizationId: deal.organizationId,
    })
    .from(deal)
    .where(eq(deal.id, filters.dealId))
    .limit(1)

  const d = rows[0]
  if (!d) {
    throw new ClientContentScopeError("not_found", "Deal not found")
  }
  if (d.organizationId !== filters.organizationId) {
    throw new ClientContentScopeError("forbidden", "Deal not in scope")
  }

  const terms = new Set<string>()
  addTerm(terms, d.name)
  await addClientTerms(filters.organizationId, d.clientId, terms)

  // Linked contacts (via deal_contact) — their names/emails are strong
  // relevance signals even when they don't belong to the deal's client.
  const linkedContacts = await db
    .select({
      name: contact.name,
      nameNative: contact.nameNative,
      email: contact.email,
      phone: contact.phone,
    })
    .from(dealContact)
    .innerJoin(contact, eq(contact.id, dealContact.contactId))
    .where(
      and(
        eq(dealContact.dealId, filters.dealId),
        eq(contact.organizationId, filters.organizationId),
        ne(contact.status, "deleted"),
      ),
    )
  for (const r of linkedContacts) {
    addTerm(terms, r.name)
    addTerm(terms, r.nameNative)
    addTerm(terms, r.email)
    addTerm(terms, r.phone)
  }

  const matchTerms = Array.from(terms)
  if (matchTerms.length === 0) {
    return { rows: [], total: 0, matchTerms: [] }
  }

  const result = await listContentByTerms({ ...filters, matchTerms })
  return { ...result, matchTerms }
}
