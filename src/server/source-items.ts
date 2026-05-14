// Not "use server" — that directive only allows async-function exports,
// and this module also exports the SourceItemScopeError class + plain
// types. `server-only` keeps the module out of the client bundle and
// trips a build error if it ever gets pulled in.
import "server-only"

import { randomUUID } from "node:crypto"
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  max,
  not,
  notInArray,
  or,
  sql,
} from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  source,
  sourceItem,
  type ParseStatus,
  type R2UploadStatus,
  type SourceItemKind,
  type SourceProvider,
} from "@/db/schema"
import { getMarkdownFromR2 } from "@/lib/r2"

// All fields on the row that fetch-time sync code knows how to populate.
// Parse-time and R2-time fields (parseStatus, parsedAt, parserVersion,
// parserModel, r2UploadStatus, r2UploadedAt, markdownR2Key,
// markdownR2SizeBytes) are owned by their own mutations and intentionally
// NOT touched by the upsert — re-syncing an item must not undo a
// successful parse / R2 upload.
export type UpsertSourceItemInput = {
  sourceId: string
  // Null for system-source items (system sources are platform-wide; their
  // items are visible to every admin). Per-org sources copy the source's
  // ownerOrganizationId here so every per-org query can hit a single
  // partial index.
  organizationId: string | null
  externalId: string
  externalType: SourceItemKind
  externalUrl?: string | null
  metadataJson?: Record<string, unknown>
  parentSourceItemId?: string | null
  threadExternalId?: string | null
  filename?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  // Provider-side timestamp (Nylas date / Chat createTime / Drive
  // modifiedTime). This is the cursor field for incremental sync.
  sourceCreatedAt?: Date | null
}

export type UpsertResult = {
  id: string
  // True on a fresh insert, false on a conflict-driven update. Computed
  // via Postgres' `xmax = 0` trick (xmax is 0 for newly-inserted tuples,
  // non-zero when the row was updated as part of ON CONFLICT).
  inserted: boolean
}

export async function upsertSourceItem(
  input: UpsertSourceItemInput,
): Promise<UpsertResult> {
  const id = randomUUID()
  const now = new Date()

  const result = await db
    .insert(sourceItem)
    .values({
      id,
      sourceId: input.sourceId,
      organizationId: input.organizationId,
      externalId: input.externalId,
      externalType: input.externalType,
      externalUrl: input.externalUrl ?? null,
      metadataJson: input.metadataJson ?? {},
      parentSourceItemId: input.parentSourceItemId ?? null,
      threadExternalId: input.threadExternalId ?? null,
      filename: input.filename ?? null,
      mimeType: input.mimeType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      sourceCreatedAt: input.sourceCreatedAt ?? null,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: [sourceItem.sourceId, sourceItem.externalId],
      set: {
        metadataJson: input.metadataJson ?? {},
        externalUrl: input.externalUrl ?? null,
        threadExternalId: input.threadExternalId ?? null,
        filename: input.filename ?? null,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        sourceCreatedAt: input.sourceCreatedAt ?? null,
        fetchedAt: now,
      },
    })
    .returning({
      id: sourceItem.id,
      inserted: sql<boolean>`xmax = 0`,
    })

  return { id: result[0].id, inserted: result[0].inserted }
}

export async function getLatestSourceCreatedAt(
  sourceId: string,
): Promise<Date | null> {
  const rows = await db
    .select({ max: max(sourceItem.sourceCreatedAt) })
    .from(sourceItem)
    .where(eq(sourceItem.sourceId, sourceId))

  return rows[0]?.max ?? null
}

export async function getSourceItemByExternalId(
  sourceId: string,
  externalId: string,
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.sourceId, sourceId),
        eq(sourceItem.externalId, externalId),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}

// ── Listing for the unified Pending / Processed tables ───────────────

export type SourceItemListStatus = "pending" | "processed"

export type SourceItemListFilters = {
  status: SourceItemListStatus
  // Required tenant scope. Items are returned only when
  // `source_item.organization_id` matches. Pass null for the platform-
  // wide system view (returns rows whose org is null — i.e. attached to
  // is_system sources). Calling code in API routes derives this from
  // `session.session.activeOrganizationId`; the orchestration layer is
  // org-agnostic and shouldn't need this listing.
  organizationId: string | null
  // Filter to a single source by id. Omit for "all sources".
  sourceId?: string
  // Free-text search over filename + metadataJson::text.
  q?: string
  dateFrom?: Date
  dateTo?: Date
  limit?: number
  offset?: number
  // Stricter Processed filter: only rows that still need to ship to
  // R2 (`parseStatus = 'complete' AND r2UploadStatus IN (pending,
  // failed)`). Skipped rows are excluded — they have no markdown to
  // upload. Ignored when status !== 'processed'.
  onlyNeedsUpload?: boolean
}

export type SourceItemRow = {
  id: string
  sourceId: string
  sourceName: string
  sourceProvider: SourceProvider
  externalId: string
  externalType: SourceItemKind
  externalUrl: string | null
  parentSourceItemId: string | null
  filename: string | null
  mimeType: string | null
  sizeBytes: number | null
  threadExternalId: string | null
  metadataJson: Record<string, unknown>
  sourceCreatedAt: Date | null
  fetchedAt: Date
  parseStatus: ParseStatus
  parsedAt: Date | null
  parseError: string | null
  parserModel: string | null
  r2UploadStatus: R2UploadStatus
  r2UploadedAt: Date | null
  markdownR2Key: string | null
  markdownR2SizeBytes: number | null
}

export type SourceItemListResult = {
  rows: SourceItemRow[]
  total: number
}

export async function listSourceItems(
  filters: SourceItemListFilters,
): Promise<SourceItemListResult> {
  const { status, organizationId, sourceId, q, dateFrom, dateTo } = filters
  const limit = Math.min(filters.limit ?? 25, 100)
  const offset = Math.max(filters.offset ?? 0, 0)

  // Pending  = roots only (no children) that haven't been parsed yet
  //            (or that failed previously). Children only exist after a
  //            successful parent parse, so they never appear in Pending.
  // Processed = anything that's been parsed (root or child), including
  //            'skipped' rows for unsupported / oversize / deleted
  //            attachments — they have no markdown but we keep the
  //            audit record. Upload status is shown per-row inside this
  //            table; a row uploaded to R2 just gets a different badge.
  // Processed + onlyNeedsUpload narrows further to rows that still
  // need shipping: parseStatus='complete' (skipped excluded — no
  // markdown to ship) AND r2UploadStatus IN (pending, failed).
  const statusClause =
    status === "processed"
      ? filters.onlyNeedsUpload
        ? and(
            eq(sourceItem.parseStatus, "complete"),
            inArray(sourceItem.r2UploadStatus, ["pending", "failed"]),
          )
        : inArray(sourceItem.parseStatus, ["complete", "skipped"])
      : and(
          inArray(sourceItem.parseStatus, ["pending", "processing", "failed"]),
          isNull(sourceItem.parentSourceItemId),
        )

  // Tenant isolation: org-scoped callers see exactly their org's rows;
  // system view sees the (currently-empty) null-org rows attached to
  // is_system sources. Either way we never return a mixed bag.
  const orgClause =
    organizationId === null
      ? isNull(sourceItem.organizationId)
      : eq(sourceItem.organizationId, organizationId)

  const where = and(
    orgClause,
    statusClause,
    sourceId ? eq(sourceItem.sourceId, sourceId) : undefined,
    dateFrom ? gte(sourceItem.sourceCreatedAt, dateFrom) : undefined,
    dateTo ? lte(sourceItem.sourceCreatedAt, dateTo) : undefined,
    q && q.trim().length > 0
      ? or(
          ilike(sourceItem.filename, `%${q}%`),
          // Postgres can ilike a jsonb cast to text — gives a cheap
          // free-text search over subjects, snippets, authors, etc.
          // without joining a full-text index.
          sql`${sourceItem.metadataJson}::text ILIKE ${`%${q}%`}`,
        )
      : undefined,
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
      metadataJson:
        (r.metadataJson as Record<string, unknown> | null) ?? {},
    })),
    total: totalRows[0]?.n ?? 0,
  }
}

// ── Stored content listing (admin / org-owner library view) ─────────
//
// Distinct from listSourceItems above:
//   • Returns rows in any state (parseStatus + r2UploadStatus filters
//     are independent — both default to "all"). The Pending / Processed
//     tables hard-clip on parseStatus; this view doesn't.
//   • Includes children (attachments, derived audio) flat in the same
//     list as roots — no parent-link visualisation. The user explicitly
//     asked for "all source_item rows are equal" semantics here.
//   • Caller-facing filters mirror the table UI: source id, mime
//     bucket, filename ILIKE, parseStatus, r2UploadStatus, and a
//     date-range on source_created_at (defaults to last 7d at the
//     route layer).

export type StoredContentMimeBucket =
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "office"
  | "other"

// Office bucket = the OOXML + legacy MS Office formats we currently
// dispatch to the office parser (docx + pptx are wired today; xlsx and
// the legacy binary formats are listed for forward-compat).
const OFFICE_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
] as const

// Maps a mime-bucket UI choice to a Drizzle WHERE clause. "Other" is
// the negative complement of every other bucket plus NULL — useful for
// surfacing email / chat_message rows which carry no mime type.
export function mimeBucketClause(bucket: StoredContentMimeBucket | undefined) {
  if (!bucket) return undefined
  switch (bucket) {
    case "pdf":
      return eq(sourceItem.mimeType, "application/pdf")
    case "image":
      return ilike(sourceItem.mimeType, "image/%")
    case "audio":
      return ilike(sourceItem.mimeType, "audio/%")
    case "video":
      return ilike(sourceItem.mimeType, "video/%")
    case "office":
      return inArray(sourceItem.mimeType, [...OFFICE_MIME_TYPES])
    case "other":
      return or(
        isNull(sourceItem.mimeType),
        and(
          not(ilike(sourceItem.mimeType, "image/%")),
          not(ilike(sourceItem.mimeType, "audio/%")),
          not(ilike(sourceItem.mimeType, "video/%")),
          not(eq(sourceItem.mimeType, "application/pdf")),
          notInArray(sourceItem.mimeType, [...OFFICE_MIME_TYPES]),
        ),
      )
  }
}

export type StoredContentFilters = {
  // Always required — Stored Content is strictly tenant-scoped (no
  // is_system bucket here). Route derives this from the active session.
  organizationId: string
  sourceId?: string
  mimeBucket?: StoredContentMimeBucket
  filenameSearch?: string
  parseStatus?: ParseStatus
  r2UploadStatus?: R2UploadStatus
  // Date range on `source_created_at` — the provider's own timestamp,
  // i.e. when the email/chat/file was created in its source system.
  // Defaults filled by the route (last 7 days).
  dateFrom?: Date
  dateTo?: Date
  limit?: number
  offset?: number
}

export async function listOrgStoredContent(
  filters: StoredContentFilters,
): Promise<SourceItemListResult> {
  const limit = Math.min(filters.limit ?? 10, 100)
  const offset = Math.max(filters.offset ?? 0, 0)

  const where = and(
    eq(sourceItem.organizationId, filters.organizationId),
    filters.sourceId ? eq(sourceItem.sourceId, filters.sourceId) : undefined,
    filters.parseStatus
      ? eq(sourceItem.parseStatus, filters.parseStatus)
      : undefined,
    filters.r2UploadStatus
      ? eq(sourceItem.r2UploadStatus, filters.r2UploadStatus)
      : undefined,
    mimeBucketClause(filters.mimeBucket),
    filters.filenameSearch && filters.filenameSearch.trim().length > 0
      ? ilike(sourceItem.filename, `%${filters.filenameSearch.trim()}%`)
      : undefined,
    filters.dateFrom ? gte(sourceItem.sourceCreatedAt, filters.dateFrom) : undefined,
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

// ── Batch-parse candidate IDs ─────────────────────────────────────────
//
// Powers the "Parse all (N)" control on the Pending table. Returns
// ids of root rows in `parseStatus IN ('pending', 'failed')` — same
// surface the per-row Parse / Re-parse button operates on, so the
// batch lets the user retry rate-limited / transient failures en
// masse. 'processing' is excluded so a click can't kick off a second
// run on the same row mid-flight. Honors the same filter context the
// table is showing so e.g. "Source = WhatsApp Archive" scopes the
// batch correctly.

export type PendingParseFilters = {
  organizationId: string | null // null = system view
  scope: R2BatchScope
  sourceId?: string
  filenameSearch?: string
  dateFrom?: Date
  dateTo?: Date
  limit?: number
}

export type PendingParseResult = {
  ids: string[]
  total: number
  cap: number
}

const PARSE_BATCH_HARD_CAP = 500

export async function listPendingParseItemIds(
  filters: PendingParseFilters,
): Promise<PendingParseResult> {
  const limit = Math.min(filters.limit ?? PARSE_BATCH_HARD_CAP, PARSE_BATCH_HARD_CAP)

  const orgClause =
    filters.organizationId === null
      ? isNull(sourceItem.organizationId)
      : eq(sourceItem.organizationId, filters.organizationId)

  const where = and(
    orgClause,
    inArray(sourceItem.parseStatus, ["pending", "failed"]),
    isNull(sourceItem.parentSourceItemId),
    filters.sourceId ? eq(sourceItem.sourceId, filters.sourceId) : undefined,
    filters.filenameSearch && filters.filenameSearch.trim().length > 0
      ? or(
          ilike(sourceItem.filename, `%${filters.filenameSearch.trim()}%`),
          sql`${sourceItem.metadataJson}::text ILIKE ${`%${filters.filenameSearch.trim()}%`}`,
        )
      : undefined,
    filters.dateFrom ? gte(sourceItem.sourceCreatedAt, filters.dateFrom) : undefined,
    filters.dateTo ? lte(sourceItem.sourceCreatedAt, filters.dateTo) : undefined,
  )

  const [rows, totalRows] = await Promise.all([
    db
      .select({ id: sourceItem.id })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(where)
      // Oldest-first so a partial run + retry processes rows in
      // stable order; matches the cron pipeline's listPendingParseIds.
      .orderBy(asc(sourceItem.sourceCreatedAt))
      .limit(limit),
    db
      .select({ n: count() })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(where),
  ])

  return {
    ids: rows.map((r) => r.id),
    total: totalRows[0]?.n ?? 0,
    cap: PARSE_BATCH_HARD_CAP,
  }
}

// ── R2-batch-upload candidate IDs ─────────────────────────────────────
//
// Powers the "Upload all to R2 (N)" control on the Processed and
// Stored Content tables. Returns the ids of rows that are ready to
// ship — `parseStatus = 'complete' AND r2UploadStatus IN (pending,
// failed) AND parsed_markdown IS NOT NULL` — within the caller's
// active filter context. Hard-capped so a pathological click can't
// blow up memory or time-budget; callers that hit the cap can re-run
// the action after the first batch finishes.

export type R2BatchScope = "org" | "system"

export type PendingR2UploadFilters = {
  organizationId: string | null // null = system view
  scope: R2BatchScope
  sourceId?: string
  // Free-text filename search (matches the Pending/Processed table's
  // `q` param — filename ILIKE only here, not metadataJson::text, so
  // batch scope is intuitive).
  filenameSearch?: string
  mimeBucket?: StoredContentMimeBucket
  dateFrom?: Date
  dateTo?: Date
  limit?: number
}

export type PendingR2UploadResult = {
  ids: string[]
  total: number
  cap: number
}

const R2_BATCH_HARD_CAP = 500

export async function listPendingR2UploadIds(
  filters: PendingR2UploadFilters,
): Promise<PendingR2UploadResult> {
  const limit = Math.min(filters.limit ?? R2_BATCH_HARD_CAP, R2_BATCH_HARD_CAP)

  const orgClause =
    filters.organizationId === null
      ? isNull(sourceItem.organizationId)
      : eq(sourceItem.organizationId, filters.organizationId)

  const where = and(
    orgClause,
    eq(sourceItem.parseStatus, "complete"),
    inArray(sourceItem.r2UploadStatus, ["pending", "failed"]),
    sql`${sourceItem.parsedMarkdown} IS NOT NULL`,
    filters.sourceId ? eq(sourceItem.sourceId, filters.sourceId) : undefined,
    mimeBucketClause(filters.mimeBucket),
    filters.filenameSearch && filters.filenameSearch.trim().length > 0
      ? ilike(sourceItem.filename, `%${filters.filenameSearch.trim()}%`)
      : undefined,
    filters.dateFrom ? gte(sourceItem.sourceCreatedAt, filters.dateFrom) : undefined,
    filters.dateTo ? lte(sourceItem.sourceCreatedAt, filters.dateTo) : undefined,
  )

  const [rows, totalRows] = await Promise.all([
    db
      .select({ id: sourceItem.id })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(where)
      // Oldest-first so a partial run + retry processes rows in stable
      // order; matches the cron pipeline's `listPendingUploadIds`.
      .orderBy(asc(sourceItem.parsedAt))
      .limit(limit),
    db
      .select({ n: count() })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(where),
  ])

  return {
    ids: rows.map((r) => r.id),
    total: totalRows[0]?.n ?? 0,
    cap: R2_BATCH_HARD_CAP,
  }
}

// ── Read parsed markdown for a single item ───────────────────────────
//
// Used by the AI chat tools (and anything else that needs to display
// or reason about a source item's body). Two-tier read:
//   1. `parsed_markdown` is the canonical copy between Parse and the
//      first successful R2 upload — return it directly.
//   2. After upload the column is cleared (R2 holds the canonical
//      copy); fall back to fetching by `markdownR2Key`.
// Returns null if the row doesn't exist, isn't parsed, was a 'skipped'
// row with no body, OR — when `requireOrganizationId` is provided — if
// the row belongs to a different org. The optional org check keeps the
// caller (chat tool / markdown route) honest without forcing every
// internal caller to know its tenant context.
export async function getSourceItemMarkdown(
  sourceItemId: string,
  options?: { requireOrganizationId?: string },
): Promise<string | null> {
  const rows = await db
    .select({
      organizationId: sourceItem.organizationId,
      parsedMarkdown: sourceItem.parsedMarkdown,
      markdownR2Key: sourceItem.markdownR2Key,
    })
    .from(sourceItem)
    .where(eq(sourceItem.id, sourceItemId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  if (
    options?.requireOrganizationId &&
    row.organizationId !== options.requireOrganizationId
  ) {
    return null
  }
  if (row.parsedMarkdown) return row.parsedMarkdown
  if (row.markdownR2Key) return await getMarkdownFromR2(row.markdownR2Key)
  return null
}

// Verifies a source item belongs to the given org (or is attached to a
// system source — `organization_id IS NULL`). Throws on mismatch /
// not-found so API routes can translate to 404/403. Returns the row's
// source provider so callers can short-circuit (e.g. dropoff re-parse).
export class SourceItemScopeError extends Error {
  constructor(
    public readonly reason: "not_found" | "forbidden",
    message: string,
  ) {
    super(message)
    this.name = "SourceItemScopeError"
  }
}

export async function assertSourceItemInScope(
  sourceItemId: string,
  organizationId: string,
): Promise<{
  id: string
  sourceId: string
  organizationId: string | null
  sourceProvider: SourceProvider
}> {
  const rows = await db
    .select({
      id: sourceItem.id,
      sourceId: sourceItem.sourceId,
      organizationId: sourceItem.organizationId,
      sourceProvider: source.provider,
    })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(eq(sourceItem.id, sourceItemId))
    .limit(1)
  const row = rows[0]
  if (!row) {
    throw new SourceItemScopeError("not_found", "Source item not found")
  }
  // Null org = system source (currently unused but kept callable so
  // org members can still act on shared platform items if those return).
  if (row.organizationId !== null && row.organizationId !== organizationId) {
    throw new SourceItemScopeError("forbidden", "Source item not in scope")
  }
  return row
}
