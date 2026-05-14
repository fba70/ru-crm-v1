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
  or,
  sql,
} from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
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
  phone: string | null
  email: string | null
  address: string | null
  webUrl: string | null
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
      phone: client.phone,
      email: client.email,
      address: client.address,
      webUrl: client.webUrl,
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
    phone: row.phone,
    email: row.email,
    address: row.address,
    webUrl: row.webUrl,
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

export async function listClientContent(
  filters: ClientContentFilters,
): Promise<ClientContentResult> {
  const limit = Math.min(filters.limit ?? 5, 100)
  const offset = Math.max(filters.offset ?? 0, 0)

  // Read the client + its full contact roster (active + suspended) so
  // the term set covers everyone who ever represented the client.
  // Same tenant-scope check as `getClientDetail`.
  const clientRows = await db
    .select({
      id: client.id,
      name: client.name,
      address: client.address,
      webUrl: client.webUrl,
      organizationId: client.organizationId,
    })
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

  const contactRows = await db
    .select({ name: contact.name, email: contact.email })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, filters.organizationId),
        eq(contact.clientId, c.id),
      ),
    )

  const terms = new Set<string>()
  function addTerm(raw: string | null | undefined) {
    if (!raw) return
    const lower = raw.trim().toLowerCase()
    if (lower.length < MIN_TERM_LENGTH) return
    terms.add(lower)
  }

  addTerm(c.name)
  addTerm(c.address)
  addTerm(normalizeWebsite(c.webUrl))
  for (const r of contactRows) {
    addTerm(r.name)
    addTerm(r.email)
  }

  const matchTerms = Array.from(terms)

  // No usable signals → empty result. The page UI surfaces this as
  // "No identifying fields on this client yet — add an email, website,
  // or contact to start matching content."
  if (matchTerms.length === 0) {
    return { rows: [], total: 0, matchTerms: [] }
  }

  const relevanceClause = or(
    ...matchTerms.map(
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
    matchTerms,
  }
}
