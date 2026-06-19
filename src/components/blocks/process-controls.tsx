"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader, Sparkles, X } from "lucide-react"
import type { ProcessProgress, ProcessRunFilters } from "./use-process-run"

const COUNT_POLL_MS = 30_000

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

function buildQuery(filters: ProcessRunFilters): string {
  const params = new URLSearchParams()
  if (filters.scope === "system") params.set("scope", "system")
  if (filters.sourceId) params.set("sourceId", filters.sourceId)
  if (filters.filenameSearch && filters.filenameSearch.trim()) {
    params.set("q", filters.filenameSearch.trim())
  }
  if (filters.dateFromIso) params.set("date_from", filters.dateFromIso)
  if (filters.dateToIso) params.set("date_to", filters.dateToIso)
  return params.toString()
}

// Shared progress bar for any in-flight process run (batch or
// sync-triggered). Rendered once at the scope level.
export function ProcessRunBar({
  progress,
  onCancel,
  cancelRequested,
}: {
  progress: ProcessProgress | null
  onCancel: () => void
  cancelRequested: boolean
}) {
  if (!progress) return null
  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 font-medium min-w-0">
          <Loader className="h-3.5 w-3.5 animate-spin shrink-0" />
          <span className="truncate">
            {progress.label ? `${progress.label}: ` : ""}обработка —{" "}
            {progress.done} / {progress.total}
            {progress.failed > 0 && (
              <span className="text-destructive ml-2">
                · ошибок {progress.failed}
              </span>
            )}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs shrink-0"
          onClick={onCancel}
          disabled={cancelRequested}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          {cancelRequested ? "Отмена…" : "Отменить"}
        </Button>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// "Обработать все (N)" — polls the work-set count for the current table
// filter context and triggers the shared run. Hidden when nothing is
// pending and no run is active. Delegates the actual loop to the parent's
// shared `run()` so it can't conflict with a sync-triggered run.
export function ProcessAllButton({
  filters,
  running,
  refreshKey,
  onRun,
}: {
  filters: ProcessRunFilters
  running: boolean
  // Bumped by the parent after sync / per-row actions so the count
  // re-polls promptly.
  refreshKey: number
  onRun: (filters: ProcessRunFilters, opts: { slow: boolean }) => void
}) {
  const [count, setCount] = useState(0)
  const [cap, setCap] = useState(500)
  const [slow, setSlow] = useState(false)

  const buildQueryString = useCallback(() => buildQuery(filters), [filters])

  const fetchCount = useCallback(async () => {
    try {
      const qs = buildQueryString()
      const res = await fetch(`/api/sources/items/process-ids?${qs}`)
      const data = await res.json()
      if (!res.ok) return
      setCount(data.total ?? 0)
      if (typeof data.cap === "number") setCap(data.cap)
    } catch {
      // Silent — count is informational.
    }
  }, [buildQueryString])

  useEffect(() => {
    if (running) return
    // False positive: fetchCount only setState()s AFTER an awaited fetch
    // (deferred, not synchronous), and its inputs (memoised filters,
    // refreshKey) are stable, so there's no cascade. Same poll pattern as
    // <R2BatchUploadControl>.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCount()
    const t = setInterval(fetchCount, COUNT_POLL_MS)
    return () => clearInterval(t)
  }, [fetchCount, running, refreshKey])

  if (running || count === 0) return null

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 flex-wrap">
      <span className="text-xs text-muted-foreground">
        {count} {plural(count, ["элемент", "элемента", "элементов"])} требует
        обработки
        {count >= cap && ` (показаны первые ${cap} за раз)`}
      </span>
      <div className="flex items-center gap-3 flex-wrap">
        <label
          className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer"
          title="Последовательно, с задержкой 4 секунды между вызовами. Используйте на бесплатном тарифе, чтобы не превысить лимит AI Gateway."
        >
          <Checkbox
            checked={slow}
            onCheckedChange={(v) => setSlow(v === true)}
          />
          Медленный режим (безопасно для бесплатного тарифа)
        </label>
        <Button
          variant="default"
          size="sm"
          className="h-8"
          onClick={() => onRun(filters, { slow })}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Обработать все ({count})
        </Button>
      </div>
    </div>
  )
}
