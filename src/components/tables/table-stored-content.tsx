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
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader,
} from "lucide-react"
import { ParsedMarkdownDialog } from "@/components/blocks/parsed-markdown-dialog"
import { R2BatchUploadControl } from "@/components/blocks/r2-batch-upload-control"
import type { SourceSummary } from "@/server/sources"
import type { ParseStatus, R2UploadStatus } from "@/db/schema"

const PAGE_SIZE = 10
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
  parseStatus: ParseStatus
  parseError: string | null
  r2UploadStatus: R2UploadStatus
  markdownR2Key: string | null
}

type Response = { rows: Row[]; total: number }

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

const MIME_BUCKETS: { value: string; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Изображение" },
  { value: "audio", label: "Аудио" },
  { value: "video", label: "Видео" },
  { value: "office", label: "Офис (Word / Excel / PowerPoint)" },
  { value: "other", label: "Другое / без типа" },
]

// Display labels for the parse/upload status badges + filters (DB enum
// values stay English).
const PARSE_STATUS_LABEL: Record<ParseStatus, string> = {
  pending: "В очереди",
  processing: "Обработка",
  complete: "Готово",
  failed: "Ошибка",
  skipped: "Пропущено",
}
const UPLOAD_STATUS_LABEL: Record<R2UploadStatus, string> = {
  pending: "В очереди",
  complete: "Готово",
  failed: "Ошибка",
}

const PARSE_STATUSES: { value: ParseStatus; label: string }[] = (
  ["pending", "processing", "complete", "failed", "skipped"] as ParseStatus[]
).map((value) => ({ value, label: PARSE_STATUS_LABEL[value] }))

const UPLOAD_STATUSES: { value: R2UploadStatus; label: string }[] = (
  ["pending", "complete", "failed"] as R2UploadStatus[]
).map((value) => ({ value, label: UPLOAD_STATUS_LABEL[value] }))

// Default sliding window — last 7 days based on `source_created_at`.
// The route applies the same default when both date params are blank,
// but pinning the input values explicitly makes them visible to the
// user and editable.
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoUtc(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("ru-RU", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Reuses the title-extraction logic from the Pending / Processed table
// so the same email / chat row reads identically across all three
// views. Google Chat uses `text`; WhatsApp groups use `rawText` (a
// markdown-formatted multi-message transcript).
function itemTitle(row: Row): string {
  const m = row.metadataJson
  if (row.externalType === "email") {
    const subject = typeof m.subject === "string" ? m.subject : ""
    return subject || "(без темы)"
  }
  if (row.externalType === "chat_message") {
    const text = typeof m.text === "string" ? m.text : ""
    if (text) return text.slice(0, 80)
    const rawText = typeof m.rawText === "string" ? m.rawText : ""
    if (rawText) {
      const preview = previewFromRawText(rawText)
      if (preview) return preview
    }
    return "(пустое сообщение)"
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

function ParseBadge({ row }: { row: Row }) {
  const ps = row.parseStatus
  const palette: Record<ParseStatus, string> = {
    pending:
      "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
    processing:
      "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200",
    complete:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200",
    failed: "bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200",
    skipped: "bg-muted text-muted-foreground",
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${palette[ps]}`}
      title={row.parseError ?? undefined}
    >
      {PARSE_STATUS_LABEL[ps]}
    </span>
  )
}

function UploadBadge({ status }: { status: R2UploadStatus }) {
  const palette: Record<R2UploadStatus, string> = {
    pending:
      "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
    complete:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200",
    failed: "bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200",
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}
    >
      {UPLOAD_STATUS_LABEL[status]}
    </span>
  )
}

// Stored content view — admin / org-owner audit table over every
// source_item belonging to the active org. Filters mirror the route's
// query params 1:1; preview action is enabled only when the row has
// reached R2 (per the user's spec: "preview is only possible for
// uploaded to R2 files").
export function TableStoredContent({
  sources,
}: {
  // Org's source dictionary, used to populate the source-id filter
  // dropdown. Threaded in from the Sources page so we don't issue a
  // second round-trip to fetch it here.
  sources: SourceSummary[]
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const [sourceId, setSourceId] = useState<string>(ALL)
  const [mime, setMime] = useState<string>(ALL)
  const [parseStatus, setParseStatus] = useState<string>(ALL)
  const [uploadStatus, setUploadStatus] = useState<string>(ALL)
  const [filenameSearch, setFilenameSearch] = useState("")
  const [dateFrom, setDateFrom] = useState<string>(() => daysAgoUtc(7))
  const [dateTo, setDateTo] = useState<string>(() => todayUtc())

  const [previewItemId, setPreviewItemId] = useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = useState("")

  // Local refresh signal — bumped after the R2 batch control finishes
  // a chunk so the row badges flip from "Needs upload" → "Done" while
  // the batch is still running.
  const [localBump, setLocalBump] = useState(0)

  const fetchPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set("limit", String(PAGE_SIZE))
      params.set("offset", String((page - 1) * PAGE_SIZE))
      if (sourceId !== ALL) params.set("sourceId", sourceId)
      if (mime !== ALL) params.set("mime", mime)
      if (parseStatus !== ALL) params.set("parse_status", parseStatus)
      if (uploadStatus !== ALL) params.set("upload_status", uploadStatus)
      if (filenameSearch.trim()) params.set("q", filenameSearch.trim())
      if (dateFrom) params.set("date_from", dateFrom)
      if (dateTo) params.set("date_to", dateTo)
      const res = await fetch(`/api/sources/stored?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось загрузить")
      const r = data as Response
      setRows(r.rows)
      setTotal(r.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка")
    } finally {
      setLoading(false)
    }
  }, [
    page,
    sourceId,
    mime,
    parseStatus,
    uploadStatus,
    filenameSearch,
    dateFrom,
    dateTo,
  ])

  useEffect(() => {
    fetchPage()
  }, [fetchPage, localBump])

  // Reset to page 1 whenever any filter changes — the previous page
  // index is meaningless against the new result set.
  useEffect(() => {
    setPage(1)
  }, [sourceId, mime, parseStatus, uploadStatus, filenameSearch, dateFrom, dateTo])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const filtersActive =
    sourceId !== ALL ||
    mime !== ALL ||
    parseStatus !== ALL ||
    uploadStatus !== ALL ||
    filenameSearch.trim().length > 0 ||
    dateFrom !== daysAgoUtc(7) ||
    dateTo !== todayUtc()

  function clearFilters() {
    setSourceId(ALL)
    setMime(ALL)
    setParseStatus(ALL)
    setUploadStatus(ALL)
    setFilenameSearch("")
    setDateFrom(daysAgoUtc(7))
    setDateTo(todayUtc())
  }

  function openPreview(row: Row) {
    setPreviewItemId(row.id)
    setPreviewTitle(itemTitle(row))
  }

  return (
    <div className="space-y-3">
      {/* Batch R2 upload — same control as on the Processed table.
          Filter context is derived from the table's current state so
          the batch matches what the user can see. Mime bucket is the
          one Stored-Content-specific filter the control honors. */}
      <R2BatchUploadControl
        filters={{
          scope: "org",
          sourceId: sourceId !== ALL ? sourceId : undefined,
          filenameSearch: filenameSearch.trim() || undefined,
          mimeBucket:
            mime !== ALL
              ? (mime as
                  | "pdf"
                  | "image"
                  | "audio"
                  | "video"
                  | "office"
                  | "other")
              : undefined,
          dateFromIso: dateFrom || undefined,
          dateToIso: dateTo || undefined,
        }}
        refreshKey={localBump}
        onActionComplete={() => setLocalBump((n) => n + 1)}
      />

      {/* Filter rows — split into two: row 1 covers the dropdowns +
          Filename (which expands to fill remaining width), row 2 holds
          the date range and Clear filters. Keeping the date inputs on
          their own row prevents them from being squeezed when several
          dropdowns are open at once. */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="min-w-44">
          <label className="text-xs text-muted-foreground mb-1 block">
            Источник
          </label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="h-8 w-full justify-between text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все источники</SelectItem>
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
            Тип файла
          </label>
          <Select value={mime} onValueChange={setMime}>
            <SelectTrigger className="h-8 w-full justify-between text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все типы</SelectItem>
              {MIME_BUCKETS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-36">
          <label className="text-xs text-muted-foreground mb-1 block">
            Статус разбора
          </label>
          <Select value={parseStatus} onValueChange={setParseStatus}>
            <SelectTrigger className="h-8 w-full justify-between text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все</SelectItem>
              {PARSE_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-36">
          <label className="text-xs text-muted-foreground mb-1 block">
            Статус загрузки
          </label>
          <Select value={uploadStatus} onValueChange={setUploadStatus}>
            <SelectTrigger className="h-8 w-full justify-between text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все</SelectItem>
              {UPLOAD_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 min-w-44">
          <label className="text-xs text-muted-foreground mb-1 block">
            Имя файла
          </label>
          <Input
            placeholder="Имя файла содержит…"
            value={filenameSearch}
            onChange={(e) => setFilenameSearch(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            С (UTC)
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
            По (UTC)
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
          Сбросить фильтры
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        {loading
          ? "Загрузка…"
          : `${total} ${plural(total, ["элемент", "элемента", "элементов"])}${filtersActive ? " (отфильтровано)" : ""}`}
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Дата</TableHead>
              <TableHead className="w-28">Источник</TableHead>
              <TableHead className="w-28">MIME</TableHead>
              <TableHead className="whitespace-normal">
                Имя файла / Заголовок
              </TableHead>
              <TableHead className="w-24">Разбор</TableHead>
              <TableHead className="w-24">Загрузка</TableHead>
              <TableHead className="w-20">Просмотр</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                    <Loader className="h-4 w-4 animate-spin" />
                    Загрузка элементов…
                  </div>
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <p className="text-sm text-destructive py-6 text-center">
                    {error}
                  </p>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Нет элементов по заданным фильтрам.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const canPreview =
                  row.r2UploadStatus === "complete" &&
                  row.markdownR2Key !== null
                return (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDate(row.sourceCreatedAt)}
                    </TableCell>
                    <TableCell className="text-xs truncate">
                      {row.sourceName}
                    </TableCell>
                    <TableCell className="text-xs truncate">
                      {row.mimeType ?? "—"}
                    </TableCell>
                    <TableCell
                      className="text-sm truncate"
                      title={itemTitle(row)}
                    >
                      {itemTitle(row)}
                    </TableCell>
                    <TableCell>
                      <ParseBadge row={row} />
                    </TableCell>
                    <TableCell>
                      <UploadBadge status={row.r2UploadStatus} />
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
                            ? "Просмотр разобранного текста из R2"
                            : "Просмотр доступен после загрузки файла в R2"
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

      {/* Pager */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Страница {page} из {totalPages}
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
