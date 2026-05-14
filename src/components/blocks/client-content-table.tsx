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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, ChevronRight, Eye, Loader } from "lucide-react"
import { ParsedMarkdownDialog } from "@/components/blocks/parsed-markdown-dialog"
import type { SourceSummary } from "@/server/sources"

const PAGE_SIZE = 5
const ALL = "__all__"

type Row = {
  id: string
  sourceId: string
  sourceName: string
  sourceProvider: string
  externalId: string
  externalType: string
  filename: string | null
  mimeType: string | null
  metadataJson: Record<string, unknown>
  sourceCreatedAt: string | null
  markdownR2Key: string | null
}

type Response = {
  rows: Row[]
  total: number
  matchTerms: string[]
}

const MIME_BUCKETS: { value: string; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
  { value: "office", label: "Office (Word / Excel / PowerPoint)" },
  { value: "other", label: "Other / no mime" },
]

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

// Item-title resolution mirrors the Stored Content table so the same
// row reads identically across both views.
function itemTitle(row: Row): string {
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
  return row.filename ?? row.externalId
}

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

// Picks up to N distinct strings from metadataJson["companies"],
// metadataJson["products"], and metadataJson["mentions"] (in that
// order) for the Categories column. Empty / non-array values are
// silently ignored.
function pickCategories(metadataJson: Record<string, unknown>, max = 3): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  function add(arr: unknown) {
    if (!Array.isArray(arr)) return
    for (const v of arr) {
      if (typeof v !== "string") continue
      const trimmed = v.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(trimmed)
      if (out.length >= max) return
    }
  }
  add(metadataJson.companies)
  if (out.length < max) add(metadataJson.products)
  if (out.length < max) add(metadataJson.mentions)
  return out
}

export function ClientContentTable({
  clientId,
  sources,
}: {
  clientId: string
  // Org's source dictionary — used to populate the Source filter
  // dropdown without a second round-trip.
  sources: SourceSummary[]
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [matchTerms, setMatchTerms] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const [sourceId, setSourceId] = useState<string>(ALL)
  const [mime, setMime] = useState<string>(ALL)
  const [filenameSearch, setFilenameSearch] = useState("")
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo] = useState<string>("")

  const [previewItemId, setPreviewItemId] = useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = useState("")

  const fetchPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set("limit", String(PAGE_SIZE))
      params.set("offset", String((page - 1) * PAGE_SIZE))
      if (sourceId !== ALL) params.set("sourceId", sourceId)
      if (mime !== ALL) params.set("mime", mime)
      if (filenameSearch.trim()) params.set("q", filenameSearch.trim())
      if (dateFrom) params.set("date_from", dateFrom)
      if (dateTo) params.set("date_to", dateTo)
      const res = await fetch(
        `/api/clients/${clientId}/content?${params.toString()}`,
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to load")
      const r = data as Response
      setRows(r.rows)
      setTotal(r.total)
      setMatchTerms(r.matchTerms)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [clientId, page, sourceId, mime, filenameSearch, dateFrom, dateTo])

  useEffect(() => {
    fetchPage()
  }, [fetchPage])

  // Reset to page 1 whenever a filter changes — the previous page index
  // is meaningless against the new result set.
  useEffect(() => {
    setPage(1)
  }, [sourceId, mime, filenameSearch, dateFrom, dateTo])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const filtersActive =
    sourceId !== ALL ||
    mime !== ALL ||
    filenameSearch.trim().length > 0 ||
    dateFrom !== "" ||
    dateTo !== ""

  function clearFilters() {
    setSourceId(ALL)
    setMime(ALL)
    setFilenameSearch("")
    setDateFrom("")
    setDateTo("")
  }

  function openPreview(row: Row) {
    setPreviewItemId(row.id)
    setPreviewTitle(itemTitle(row))
  }

  return (
    <div className="space-y-3">
      {/* Filter row */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="min-w-44">
          <label className="text-xs text-muted-foreground mb-1 block">
            Source
          </label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="h-8 w-full justify-between text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All sources</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-44">
          <label className="text-xs text-muted-foreground mb-1 block">
            File type
          </label>
          <Select value={mime} onValueChange={setMime}>
            <SelectTrigger className="h-8 w-full justify-between text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {MIME_BUCKETS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 min-w-44">
          <label className="text-xs text-muted-foreground mb-1 block">
            Filename / metadata
          </label>
          <Input
            placeholder="Contains…"
            value={filenameSearch}
            onChange={(e) => setFilenameSearch(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            From (UTC)
          </label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            To (UTC)
          </label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

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

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {loading
            ? "Loading…"
            : `${total} ${total === 1 ? "item" : "items"}${filtersActive ? " (filtered)" : ""}`}
        </span>
        {matchTerms.length > 0 && (
          <span
            className="truncate max-w-[60%]"
            title={`Matched on: ${matchTerms.join(", ")}`}
          >
            Matched on: {matchTerms.slice(0, 4).join(", ")}
            {matchTerms.length > 4 ? `, +${matchTerms.length - 4} more` : ""}
          </span>
        )}
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Date</TableHead>
              <TableHead className="w-32">Source</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="w-56">Categories</TableHead>
              <TableHead className="w-16">Preview</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                    <Loader className="h-4 w-4 animate-spin" />
                    Loading items…
                  </div>
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <p className="text-sm text-destructive py-6 text-center">
                    {error}
                  </p>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    {matchTerms.length === 0
                      ? "No identifying fields on this client yet — add an email, website, or contact to start matching content."
                      : "No content matches these filters."}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const cats = pickCategories(row.metadataJson)
                const canPreview = row.markdownR2Key !== null
                const title = itemTitle(row)
                return (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDate(row.sourceCreatedAt)}
                    </TableCell>
                    <TableCell className="text-xs truncate">
                      {row.sourceName}
                    </TableCell>
                    <TableCell
                      className="text-sm truncate"
                      title={title}
                    >
                      {title}
                    </TableCell>
                    <TableCell>
                      {cats.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {cats.map((c) => (
                            <span
                              key={c}
                              className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={!canPreview}
                        onClick={() => openPreview(row)}
                        title={
                          canPreview
                            ? "Preview parsed markdown from R2"
                            : "Preview not available"
                        }
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ParsedMarkdownDialog
        itemId={previewItemId}
        title={previewTitle}
        open={previewItemId !== null}
        onOpenChange={(o) => {
          if (!o) setPreviewItemId(null)
        }}
      />

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
