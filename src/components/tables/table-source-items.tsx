"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
  Loader,
  Sparkles,
  Eye,
  RefreshCcw,
} from "lucide-react"
import { toast } from "sonner"
import { ParsedMarkdownDialog } from "@/components/blocks/parsed-markdown-dialog"
import { ProcessAllButton } from "@/components/blocks/process-controls"
import type { ProcessRunFilters } from "@/components/blocks/use-process-run"
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

type SourceItemView = "needs_work" | "done" | "errors" | "all"

const PAGE_SIZE = 10
const ALL_SOURCES = "__all__"

const VIEW_LABELS: Record<SourceItemView, string> = {
  needs_work: "Требуют обработки",
  done: "Готово",
  errors: "Ошибки",
  all: "Все",
}
const VIEW_ORDER: SourceItemView[] = ["needs_work", "done", "errors", "all"]

// 'done' / 'all' grow unbounded, so they get a default date window
// (today) to keep the COUNT + page query cheap. 'needs_work' / 'errors'
// drain to zero, so they're shown unbounded.
const DATE_BOUNDED_VIEWS: ReadonlySet<SourceItemView> = new Set([
  "done",
  "all",
])

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

function daysBackToInputDate(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// ── Display helpers ───────────────────────────────────────────────────

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

function itemTitle(row: SourceItemRow): string {
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
  if (row.externalType === "drive_file") {
    return row.filename ?? "(файл без имени)"
  }
  if (row.externalType === "dropoff_file") {
    return row.filename ?? "(загруженный файл)"
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

// ── Status badges (one per sub-process) ──────────────────────────────

type Tone = "amber" | "red" | "blue" | "gray" | "green"

function Badge({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  const palette: Record<Tone, string> = {
    amber: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
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

function ParseBadge({ row }: { row: SourceItemRow }) {
  switch (row.parseStatus) {
    case "failed":
      return <Badge tone="red">Ошибка</Badge>
    case "processing":
      return <Badge tone="blue">Разбор…</Badge>
    case "skipped":
      return <Badge tone="gray">Пропущено</Badge>
    case "complete":
      return <Badge tone="green">Готово</Badge>
    default:
      return <Badge tone="amber">В очереди</Badge>
  }
}

function UploadBadge({ row }: { row: SourceItemRow }) {
  // Upload only matters once parsed. Skipped rows produce no markdown,
  // so upload is genuinely N/A.
  if (row.parseStatus === "skipped") return <Badge tone="gray">—</Badge>
  if (row.parseStatus !== "complete")
    return <span className="text-xs text-muted-foreground">—</span>
  switch (row.r2UploadStatus) {
    case "failed":
      return <Badge tone="red">Ошибка</Badge>
    case "complete":
      return <Badge tone="green">Готово</Badge>
    default:
      return <Badge tone="amber">В очереди</Badge>
  }
}

// ── Component ────────────────────────────────────────────────────────

export function TableSourceItems({
  sources,
  refreshKey,
  onActionComplete,
  processRunning,
  onRunAll,
  periodFrom = "",
  periodTo = "",
}: {
  sources: SourceSummary[]
  // Bumped by the parent on sync / completed batch runs.
  refreshKey: number
  // Called after a per-row action so the parent can re-poll counts.
  onActionComplete: () => void
  // True while a shared batch/sync run is in flight — disables per-row
  // actions so a single row can't fight the batch loop.
  processRunning: boolean
  // Hands the table's current filter context to the shared runner.
  onRunAll: (filters: ProcessRunFilters, opts: { slow: boolean }) => void
  // "Processing period" from the action bar (YYYY-MM-DD, empty = none). When
  // set it bounds BOTH this listing AND "Обработать все" by source_created_at,
  // across every view, and supersedes the table's own date inputs.
  periodFrom?: string
  periodTo?: string
}) {
  const [rows, setRows] = useState<SourceItemRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<SourceItemView>("needs_work")
  const [sourceFilter, setSourceFilter] = useState<string>(ALL_SOURCES)
  const [q, setQ] = useState("")
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo] = useState<string>("")
  const [page, setPage] = useState(1)

  const dateBounded = DATE_BOUNDED_VIEWS.has(view)

  // Effective date bound: the action-bar "Период обработки" wins when set and
  // applies to EVERY view; otherwise fall back to the table's own date inputs
  // (only meaningful in the date-bounded views).
  const periodActive = !!(periodFrom || periodTo)
  const effDateFrom = periodActive ? periodFrom : dateBounded ? dateFrom : ""
  const effDateTo = periodActive ? periodTo : dateBounded ? dateTo : ""

  // Per-row in-flight tracking.
  const [actionInFlight, setActionInFlight] = useState<
    Record<string, "process" | "reparse" | undefined>
  >({})

  const [showItemId, setShowItemId] = useState<string | null>(null)
  const [showItemTitle, setShowItemTitle] = useState<string>("")
  const [localBump, setLocalBump] = useState(0)

  const fetchPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set("view", view)
      params.set("limit", String(PAGE_SIZE))
      params.set("offset", String((page - 1) * PAGE_SIZE))
      if (sourceFilter !== ALL_SOURCES) params.set("sourceId", sourceFilter)
      if (q.trim()) params.set("q", q.trim())
      if (effDateFrom) params.set("date_from", effDateFrom)
      if (effDateTo) params.set("date_to", effDateTo)
      const res = await fetch(`/api/sources/items?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось загрузить элементы")
      const result = data as SourceItemListResponse
      setRows(result.rows)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка")
    } finally {
      setLoading(false)
    }
  }, [view, sourceFilter, q, effDateFrom, effDateTo, page])

  useEffect(() => {
    fetchPage()
  }, [fetchPage, refreshKey, localBump])

  // When switching into a date-bounded view, seed today's window; when
  // switching to an unbounded (work-queue) view, clear it so the whole
  // backlog is visible.
  useEffect(() => {
    if (DATE_BOUNDED_VIEWS.has(view)) {
      setDateFrom((f) => f || daysBackToInputDate(0))
    } else {
      setDateFrom("")
      setDateTo("")
    }
  }, [view])

  useEffect(() => {
    setPage(1)
  }, [view, sourceFilter, q, effDateFrom, effDateTo])

  async function runProcess(rowId: string) {
    setActionInFlight((m) => ({ ...m, [rowId]: "process" }))
    try {
      const res = await fetch(`/api/sources/items/${rowId}/process`, {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Ошибка обработки")
      if (data?.ok === false) {
        throw new Error(data?.error || "Обработка завершилась с ошибкой")
      }
      toast.success("Обработано")
      setLocalBump((n) => n + 1)
      onActionComplete()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Неизвестная ошибка")
      setLocalBump((n) => n + 1)
    } finally {
      setActionInFlight((m) => {
        const next = { ...m }
        delete next[rowId]
        return next
      })
    }
  }

  async function runReparse(rowId: string) {
    setActionInFlight((m) => ({ ...m, [rowId]: "reparse" }))
    try {
      const res = await fetch(`/api/sources/items/${rowId}/reparse`, {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Ошибка повторного разбора")
      toast.success("Сброшено для повторной обработки")
      setLocalBump((n) => n + 1)
      onActionComplete()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Неизвестная ошибка")
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const filtersActive =
    view !== "needs_work" ||
    sourceFilter !== ALL_SOURCES ||
    q.trim().length > 0

  function clearFilters() {
    setView("needs_work")
    setSourceFilter(ALL_SOURCES)
    setQ("")
    setDateFrom("")
    setDateTo("")
  }

  // Memoised so the child count-poll effect doesn't re-run every render
  // (the object identity would otherwise change on each parent render).
  const runFilters: ProcessRunFilters = useMemo(
    () => ({
      scope: "org",
      sourceId: sourceFilter !== ALL_SOURCES ? sourceFilter : undefined,
      filenameSearch: q.trim() || undefined,
      dateFromIso: effDateFrom || undefined,
      dateToIso: effDateTo || undefined,
    }),
    [sourceFilter, q, effDateFrom, effDateTo],
  )

  return (
    <div className="space-y-3">
      {/* "Обработать все" — uses the table's current filter context.
          Delegates to the shared runner so it can't conflict with a
          sync-triggered run. */}
      <ProcessAllButton
        filters={runFilters}
        running={processRunning}
        refreshKey={refreshKey + localBump}
        onRun={onRunAll}
      />

      {/* Filter row */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="min-w-44">
          <label className="text-xs text-muted-foreground mb-1 block">
            Состояние
          </label>
          <Select
            value={view}
            onValueChange={(v) => setView(v as SourceItemView)}
          >
            <SelectTrigger className="h-8 w-full justify-between text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIEW_ORDER.map((v) => (
                <SelectItem key={v} value={v}>
                  {VIEW_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-44">
          <label className="text-xs text-muted-foreground mb-1 block">
            Источник
          </label>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-8 w-full justify-between text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SOURCES}>Все источники</SelectItem>
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
            Поиск
          </label>
          <Input
            placeholder="Тема / отправитель / имя файла…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        {periodActive ? (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Период обработки
            </label>
            <div className="flex h-8 items-center rounded-md border bg-muted/40 px-2 text-sm text-muted-foreground">
              {periodFrom || "…"} — {periodTo || "…"}
            </div>
          </div>
        ) : (
          dateBounded && (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  С
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
                  По
                </label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </>
          )
        )}
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
          : `${total} ${plural(total, ["элемент", "элемента", "элементов"])}`}
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Дата</TableHead>
              <TableHead className="w-28">Источник</TableHead>
              <TableHead className="w-28">Автор</TableHead>
              <TableHead>Элемент</TableHead>
              <TableHead className="w-24">Разбор</TableHead>
              <TableHead className="w-24">Загрузка</TableHead>
              <TableHead className="w-28">Действия</TableHead>
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
                    {view === "needs_work"
                      ? "Всё обработано. Нажмите «Синхронизировать» выше, чтобы получить новые материалы."
                      : "Нет элементов по заданным фильтрам."}
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
                    </TableCell>
                    <TableCell>
                      <ParseBadge row={row} />
                    </TableCell>
                    <TableCell>
                      <UploadBadge row={row} />
                    </TableCell>
                    <TableCell>
                      <RowActions
                        row={row}
                        inFlight={inFlight}
                        disabled={processRunning}
                        onProcess={() => runProcess(row.id)}
                        onReparse={() => runReparse(row.id)}
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

// ── Per-row actions ──────────────────────────────────────────────────
//
// One smart «Обработать» button whose effect depends on state (parse →
// upload, or just upload), plus Show (when parsed) and Re-parse (roots
// with persisted bytes). Skipped rows are terminal — only Show/—.

function RowActions({
  row,
  inFlight,
  disabled,
  onProcess,
  onReparse,
  onShow,
}: {
  row: SourceItemRow
  inFlight: "process" | "reparse" | undefined
  disabled: boolean
  onProcess: () => void
  onReparse: () => void
  onShow: () => void
}) {
  const isRoot = row.parentSourceItemId === null
  const ps = row.parseStatus
  const rs = row.r2UploadStatus
  const canReparse =
    isRoot && getProvider(row.sourceProvider).capabilities.hasRawBytesPersisted
  const canShow = ps === "complete"
  // Needs work = not yet parsed, OR parsed-but-unshipped.
  const needsWork =
    ps === "pending" ||
    ps === "failed" ||
    (ps === "complete" && rs !== "complete")
  const isProcessingServerSide = ps === "processing"

  return (
    <div className="flex items-center gap-1">
      {isProcessingServerSide ? (
        <span className="inline-flex items-center text-xs text-muted-foreground">
          <Loader className="h-3.5 w-3.5 mr-1 animate-spin" />
          обработка
        </span>
      ) : needsWork ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={disabled || inFlight === "process"}
          onClick={onProcess}
          title={ps === "failed" ? (row.parseError ?? undefined) : undefined}
        >
          {inFlight === "process" ? (
            <Loader className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1" />
          )}
          {ps === "failed" || rs === "failed" ? "Повторить" : "Обработать"}
        </Button>
      ) : ps === "skipped" ? (
        <span className="text-xs text-muted-foreground">—</span>
      ) : null}

      {canShow && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onShow}
          title="Показать разобранный текст"
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
      )}
      {canReparse && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={disabled || inFlight === "reparse"}
          onClick={onReparse}
          title="Повторный разбор (удаляет дочерние элементы и строку R2, заново из очереди)"
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
