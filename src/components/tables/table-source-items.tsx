"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChevronLeft,
  ChevronRight,
  Loader,
  Sparkles,
  CloudUpload,
  Eye,
  RefreshCcw,
} from "lucide-react"
import { toast } from "sonner"
import { ParsedMarkdownDialog } from "@/components/blocks/parsed-markdown-dialog"
import { R2BatchUploadControl } from "@/components/blocks/r2-batch-upload-control"
import { ParseBatchControl } from "@/components/blocks/parse-batch-control"
import type { SourceSummary, SystemSource } from "@/server/sources"
import { getProvider } from "@/lib/sources/providers"

// ── Types matching the GET /api/sources/items response ───────────────

type SourceItemListResponse = {
  rows: SourceItemRow[]
  total: number
}

type SourceItemRow = {
  id: string
  sourceId: string
  sourceName: string
  sourceProvider: string
  externalId: string
  externalType: string
  externalUrl: string | null
  parentSourceItemId: string | null
  filename: string | null
  mimeType: string | null
  sizeBytes: number | null
  threadExternalId: string | null
  metadataJson: Record<string, unknown>
  sourceCreatedAt: string | null
  fetchedAt: string
  parseStatus: "pending" | "processing" | "complete" | "failed" | "skipped"
  parsedAt: string | null
  parseError: string | null
  parserModel: string | null
  r2UploadStatus: "pending" | "complete" | "failed"
  r2UploadedAt: string | null
  markdownR2Key: string | null
  markdownR2SizeBytes: number | null
}

const PAGE_SIZE = 5
const ALL_SOURCES = "__all__"

// The Processed table can grow without bound — every parsed item ever
// stays there. Both the LIMIT/OFFSET select AND the COUNT(*) total
// would scan the whole table without a date filter, so we always pin a
// minimum range (default = today). Presets cover the three windows we
// expect to be useful; manual From/To inputs still allow custom picks
// for one-off investigations. Pending is naturally bounded (it drains
// to zero each cron run) and keeps no default range.
const PROCESSED_DEFAULT_DAYS_BACK = 0 // = today only

// Returns YYYY-MM-DD for `today - days` in UTC. Matches the WorkflowStatistics
// card's preset handling so users see consistent date semantics across
// the page.
function daysBackToInputDate(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// ── Display helpers ───────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Pull a sensible "title" out of metadataJson for each item kind. The
// shapes are set by the per-provider sync functions in src/server/sync/
// (Google Chat uses `text`; WhatsApp groups use `rawText` with a
// markdown-formatted multi-message transcript).
function itemTitle(row: SourceItemRow): string {
  const m = row.metadataJson
  if (row.externalType === "email") {
    const subject = typeof m.subject === "string" ? m.subject : ""
    return subject || "(no subject)"
  }
  if (row.externalType === "chat_message") {
    const text = typeof m.text === "string" ? m.text : ""
    if (text) return text.slice(0, 80)
    const rawText = typeof m.rawText === "string" ? m.rawText : ""
    if (rawText) {
      const preview = previewFromRawText(rawText)
      if (preview) return preview
    }
    return "(empty message)"
  }
  if (row.externalType === "drive_file") {
    return row.filename ?? "(unnamed file)"
  }
  if (row.externalType === "dropoff_file") {
    return row.filename ?? "(uploaded file)"
  }
  return row.filename ?? row.externalId
}

// First non-header line from a WhatsApp transcript. The transcript
// format is `**TIMESTAMP** · **AUTHOR**\n\nBODY\n\n…` (see
// renderGroupTranscript in src/server/parsers/whatsapp.ts), so we
// skip the bolded header lines and the `_attachments: …_` markers
// to find the first piece of actual user-typed content.
function previewFromRawText(rawText: string): string {
  const lines = rawText.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith("**") && trimmed.endsWith("**")) continue
    if (trimmed.startsWith("_attachments:")) continue
    return trimmed.slice(0, 80)
  }
  return ""
}

function itemAuthor(row: SourceItemRow): string {
  const m = row.metadataJson
  if (row.externalType === "email") {
    const from = m.from
    if (Array.isArray(from) && from.length > 0) {
      const first = from[0] as { email?: string; name?: string }
      return first.name || first.email || "—"
    }
    return "—"
  }
  if (row.externalType === "chat_message") {
    return typeof m.author === "string" ? m.author : "—"
  }
  if (row.externalType === "drive_file") {
    const owners = m.owners
    if (Array.isArray(owners) && owners.length > 0) {
      return String(owners[0])
    }
    return "—"
  }
  return "—"
}

function attachmentCount(row: SourceItemRow): number {
  const v = row.metadataJson.attachmentCount
  return typeof v === "number" ? v : 0
}

// ── Status badges ────────────────────────────────────────────────────

function StatusBadge({ row }: { row: SourceItemRow }) {
  const { parseStatus: ps, r2UploadStatus: rs } = row
  if (ps === "failed") {
    return <Badge tone="red">Parse failed</Badge>
  }
  if (ps === "processing") {
    return <Badge tone="blue">Parsing…</Badge>
  }
  if (ps === "skipped") {
    return <Badge tone="gray">Skipped</Badge>
  }
  if (ps !== "complete") {
    return <Badge tone="amber">Needs parse</Badge>
  }
  // ps === complete → look at upload
  if (rs === "failed") {
    return <Badge tone="red">Upload failed</Badge>
  }
  if (rs !== "complete") {
    return <Badge tone="amber">Needs upload</Badge>
  }
  return <Badge tone="green">Done</Badge>
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: "amber" | "red" | "blue" | "gray" | "green"
}) {
  const palette: Record<typeof tone, string> = {
    amber:
      "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
    red: "bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200",
    blue: "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200",
    gray: "bg-muted text-muted-foreground",
    green:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200",
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${palette[tone]}`}
    >
      {children}
    </span>
  )
}

// ── Component ────────────────────────────────────────────────────────

export function TableSourceItems({
  status,
  scope,
  sources,
  refreshKey,
  onActionComplete,
}: {
  status: "pending" | "processed"
  // Tenant scope. "org" → caller's active org (the default for every
  // tab the user actually uses). "system" → null-org rows attached to
  // is_system sources (currently empty). The value is passed through to
  // /api/sources/items via `?scope=` so the listing matches the source
  // dictionary the table is rendering.
  scope: "org" | "system"
  sources: SourceSummary[]
  // Bumped by the parent's Sync action bar after a successful sync —
  // this re-runs the fetch effect so the freshly-synced rows appear.
  refreshKey: number
  // Called after a per-row action (Parse/Upload/Re-parse) succeeds so
  // the sibling table can refresh too — Parse moves rows from Pending
  // to Processed; Re-parse moves them back.
  onActionComplete?: () => void
}) {
  const [rows, setRows] = useState<SourceItemRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Default range is per-table: Processed pins a minimum window (see
  // PROCESSED_DEFAULT_DAYS_BACK comment) so the count + select stay
  // bounded; Pending starts unfiltered.
  const defaultDateFrom =
    status === "processed"
      ? daysBackToInputDate(PROCESSED_DEFAULT_DAYS_BACK)
      : ""
  const defaultDateTo = ""

  const [sourceFilter, setSourceFilter] = useState<string>(ALL_SOURCES)
  const [q, setQ] = useState("")
  const [dateFrom, setDateFrom] = useState<string>(defaultDateFrom)
  const [dateTo, setDateTo] = useState<string>(defaultDateTo)
  // Processed-only refinement: when on, hide rows already in R2 (and
  // skipped rows). Useful for working through the upload backlog
  // without scrolling past finished items. Server enforces the
  // narrower clause via `?only_needs_upload=1`.
  const [onlyNeedsUpload, setOnlyNeedsUpload] = useState(false)
  const [page, setPage] = useState(1)

  // Per-row in-flight tracking for action buttons. Single map keyed on
  // row id with the action name so a row can only have one action at a
  // time (no parallel parse + reparse on the same row).
  const [actionInFlight, setActionInFlight] = useState<
    Record<string, "parse" | "upload" | "reparse" | undefined>
  >({})

  // Show modal state.
  const [showItemId, setShowItemId] = useState<string | null>(null)
  const [showItemTitle, setShowItemTitle] = useState<string>("")

  // Local refresh — re-fetch the current page after an action completes.
  const [localBump, setLocalBump] = useState(0)

  const fetchPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set("status", status)
      // System tab queries the null-org bucket; default (omitted) is
      // the caller's active org as derived server-side from the session.
      if (scope === "system") params.set("scope", "system")
      params.set("limit", String(PAGE_SIZE))
      params.set("offset", String((page - 1) * PAGE_SIZE))
      if (sourceFilter !== ALL_SOURCES) params.set("sourceId", sourceFilter)
      if (q.trim()) params.set("q", q.trim())
      if (dateFrom) params.set("date_from", dateFrom)
      if (dateTo) params.set("date_to", dateTo)
      if (status === "processed" && onlyNeedsUpload) {
        params.set("only_needs_upload", "1")
      }
      const res = await fetch(`/api/sources/items?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to load items")
      const result = data as SourceItemListResponse
      setRows(result.rows)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [status, scope, sourceFilter, q, dateFrom, dateTo, onlyNeedsUpload, page])

  useEffect(() => {
    fetchPage()
  }, [fetchPage, refreshKey, localBump])

  async function runAction(
    rowId: string,
    action: "parse" | "upload" | "reparse",
    label: string,
  ) {
    setActionInFlight((m) => ({ ...m, [rowId]: action }))
    try {
      const url =
        action === "parse"
          ? `/api/sources/items/${rowId}/parse`
          : action === "reparse"
            ? `/api/sources/items/${rowId}/reparse`
            : `/api/sources/r2/save`
      const init: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
      if (action === "upload") {
        init.body = JSON.stringify({ sourceItemId: rowId })
      }
      const res = await fetch(url, init)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `${label} failed`)
      // parseSourceItem returns HTTP 200 with `parentStatus: 'failed'`
      // on parser errors (see ParseResult). Treat that as a failure
      // toast — otherwise a silent LLM failure looks like success.
      if (action === "parse" && data?.parentStatus === "failed") {
        throw new Error(
          data?.parentParseError || "Parse failed; see row error message",
        )
      }
      // 'skipped' parents (filtered email, deleted at provider, etc.)
      // are an expected outcome — keep the success toast but mention
      // the reason so the user knows the row didn't produce content.
      if (action === "parse" && data?.parentStatus === "skipped") {
        toast.message(
          `${label} skipped: ${data?.parentParseError ?? "unknown reason"}`,
        )
      } else {
        toast.success(`${label} succeeded`)
      }
      // Bump both this table AND the sibling Pending↔Processed table —
      // a parse moves rows across the boundary, so the parent's
      // refreshKey is the right cross-table signal.
      setLocalBump((n) => n + 1)
      onActionComplete?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      toast.error(`${label}: ${msg}`)
    } finally {
      setActionInFlight((m) => {
        const next = { ...m }
        delete next[rowId]
        return next
      })
    }
  }

  function openShow(row: SourceItemRow) {
    setShowItemId(row.id)
    setShowItemTitle(itemTitle(row))
  }

  // Reset to page 1 whenever a filter changes, since the existing page
  // index is meaningless against the new result set.
  useEffect(() => {
    setPage(1)
  }, [sourceFilter, q, dateFrom, dateTo, onlyNeedsUpload, status])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const showProcessedColumns = status === "processed"

  // "Filtered" relative to the table's defaults — for Processed that
  // means the date range has been moved off `today`, not just any date
  // input being non-empty.
  const filtersActive =
    sourceFilter !== ALL_SOURCES ||
    q.trim().length > 0 ||
    dateFrom !== defaultDateFrom ||
    dateTo !== defaultDateTo ||
    onlyNeedsUpload

  function clearFilters() {
    setSourceFilter(ALL_SOURCES)
    setQ("")
    setDateFrom(defaultDateFrom)
    setDateTo(defaultDateTo)
    setOnlyNeedsUpload(false)
  }

  function setProcessedRange(daysBack: number) {
    setDateFrom(daysBackToInputDate(daysBack))
    setDateTo("")
  }

  return (
    <div className="space-y-3">
      {/* Batch parse — only on the Pending table. Hides itself when
          no rows are eligible. Targets `parseStatus = 'pending'` only;
          'failed' rows stay manual via the per-row Re-parse button. */}
      {status === "pending" && (
        <ParseBatchControl
          filters={{
            scope,
            sourceId: sourceFilter !== ALL_SOURCES ? sourceFilter : undefined,
            filenameSearch: q.trim() || undefined,
            dateFromIso: dateFrom || undefined,
            dateToIso: dateTo || undefined,
          }}
          refreshKey={refreshKey + localBump}
          onActionComplete={() => {
            setLocalBump((n) => n + 1)
            onActionComplete?.()
          }}
        />
      )}

      {/* Batch R2 upload — only meaningful on the Processed table.
          The control hides itself when no rows are eligible. */}
      {status === "processed" && (
        <R2BatchUploadControl
          filters={{
            scope,
            sourceId: sourceFilter !== ALL_SOURCES ? sourceFilter : undefined,
            filenameSearch: q.trim() || undefined,
            dateFromIso: dateFrom || undefined,
            dateToIso: dateTo || undefined,
          }}
          refreshKey={refreshKey + localBump}
          onActionComplete={() => {
            setLocalBump((n) => n + 1)
            onActionComplete?.()
          }}
        />
      )}

      {/* Filter row */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="min-w-44">
          <label className="text-xs text-muted-foreground mb-1 block">
            Source
          </label>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-8 w-full justify-between text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SOURCES}>All sources</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-48">
          <label className="text-xs text-muted-foreground mb-1 block">
            Search
          </label>
          <Input
            placeholder="Subject / sender / filename…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            From
          </label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        {status === "processed" && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setProcessedRange(0)}
            >
              Last day
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setProcessedRange(6)}
            >
              Last week
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setProcessedRange(29)}
            >
              Last month
            </Button>
            <label className="flex items-center gap-2 h-8 text-xs text-muted-foreground select-none cursor-pointer">
              <Checkbox
                checked={onlyNeedsUpload}
                onCheckedChange={(v) => setOnlyNeedsUpload(v === true)}
              />
              Need upload only
            </label>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!filtersActive}
          onClick={clearFilters}
        >
          Clear filters
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        {loading
          ? "Loading…"
          : `${total} ${total === 1 ? "item" : "items"}${filtersActive ? " (filtered)" : ""}`}
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Date</TableHead>
              <TableHead className="w-32">Source</TableHead>
              <TableHead className="w-36">Author</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="w-28">Status</TableHead>
              {showProcessedColumns && (
                <TableHead className="w-36">Parsed at</TableHead>
              )}
              <TableHead className={status === "pending" ? "w-32" : "w-40"}>
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={showProcessedColumns ? 7 : 6}>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                    <Loader className="h-4 w-4 animate-spin" />
                    Loading items…
                  </div>
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={showProcessedColumns ? 7 : 6}>
                  <p className="text-sm text-destructive py-6 text-center">
                    {error}
                  </p>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showProcessedColumns ? 7 : 6}>
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    {status === "pending"
                      ? "No pending items. Click a Sync button above to fetch new ones."
                      : "No processed items yet."}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const inFlight = actionInFlight[row.id]
                const isChild = row.parentSourceItemId !== null
                return (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDate(row.sourceCreatedAt)}
                    </TableCell>
                    <TableCell className="text-xs truncate">
                      <span className="inline-flex items-center gap-1.5">
                        {(() => {
                          const Icon = getProvider(row.sourceProvider).icon
                          return (
                            <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                          )
                        })()}
                        {row.sourceName}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs truncate">
                      {itemAuthor(row)}
                    </TableCell>
                    <TableCell
                      className="text-sm truncate"
                      title={
                        row.parseError
                          ? `${itemTitle(row)} — ${row.parseError}`
                          : itemTitle(row)
                      }
                    >
                      {isChild && (
                        <span className="text-muted-foreground mr-1">↳</span>
                      )}
                      {itemTitle(row)}
                      {!isChild &&
                        status === "pending" &&
                        attachmentCount(row) > 0 && (
                          <span className="text-xs text-muted-foreground ml-2">
                            ({attachmentCount(row)} att.)
                          </span>
                        )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge row={row} />
                    </TableCell>
                    {showProcessedColumns && (
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDate(row.parsedAt)}
                      </TableCell>
                    )}
                    <TableCell>
                      <RowActions
                        row={row}
                        status={status}
                        inFlight={inFlight}
                        onParse={() => runAction(row.id, "parse", "Parse")}
                        onUpload={() => runAction(row.id, "upload", "Upload")}
                        onReparse={() =>
                          runAction(row.id, "reparse", "Re-parse")
                        }
                        onShow={() => openShow(row)}
                      />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ParsedMarkdownDialog
        itemId={showItemId}
        title={showItemTitle}
        open={showItemId !== null}
        onOpenChange={(o) => {
          if (!o) setShowItemId(null)
        }}
      />

      {/* Pager */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Per-row actions ──────────────────────────────────────────────────

function RowActions({
  row,
  status,
  inFlight,
  onParse,
  onUpload,
  onReparse,
  onShow,
}: {
  row: SourceItemRow
  status: "pending" | "processed"
  inFlight: "parse" | "upload" | "reparse" | undefined
  onParse: () => void
  onUpload: () => void
  onReparse: () => void
  onShow: () => void
}) {
  const isRoot = row.parentSourceItemId === null
  const ps = row.parseStatus
  const rs = row.r2UploadStatus
  const isChild = !isRoot
  // Re-parse needs raw bytes to re-feed the parser. Drop-off discards
  // bytes after the upload-time parse; AI Chat sessions are created
  // from in-memory chat state at Save time. Both have
  // `hasRawBytesPersisted: false` in the registry, so the same flag
  // covers any future provider with no re-fetchable source.
  const canReparse =
    isRoot && getProvider(row.sourceProvider).capabilities.hasRawBytesPersisted

  if (status === "pending") {
    // Pending shows only roots — see listSourceItems filter. Defensively
    // hide actions if a child somehow lands here.
    if (isChild) return <span className="text-xs text-muted-foreground">—</span>
    if (ps === "processing") {
      return (
        <span className="inline-flex items-center text-xs text-muted-foreground">
          <Loader className="h-3.5 w-3.5 mr-1 animate-spin" />
          parsing
        </span>
      )
    }
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={inFlight === "parse"}
        onClick={onParse}
        title={ps === "failed" ? (row.parseError ?? undefined) : undefined}
      >
        {inFlight === "parse" ? (
          <Loader className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 mr-1" />
        )}
        {ps === "failed" ? "Re-parse" : "Parse"}
      </Button>
    )
  }

  // Processed table.
  // - skipped row → no actions, just badge handled by Status column
  // - complete + uploaded → Show + Re-parse (root only)
  // - complete + not uploaded → Upload + Show + Re-parse (root only)
  // - complete + upload failed → Upload (retry) + Show + Re-parse (root)
  if (ps === "skipped") {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const showUpload = ps === "complete" && rs !== "complete"
  return (
    <div className="flex items-center gap-1">
      {showUpload && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={inFlight === "upload"}
          onClick={onUpload}
        >
          {inFlight === "upload" ? (
            <Loader className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <CloudUpload className="h-3.5 w-3.5 mr-1" />
          )}
          {rs === "failed" ? "Retry" : "Upload"}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={onShow}
        title="Show parsed markdown"
      >
        <Eye className="h-3.5 w-3.5" />
      </Button>
      {canReparse && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={inFlight === "reparse"}
          onClick={onReparse}
          title="Re-parse (deletes children + R2 row, restarts from Pending)"
        >
          {inFlight === "reparse" ? (
            <Loader className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </div>
  )
}

// Re-export so the page doesn't need to import `SystemSource` from a
// deeply-nested module path.
export type { SystemSource }
