"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

// Concurrency knobs. Default: 3-wide parallel, no delay. Slow mode:
// 1-wide + 4s gap (keeps request rate ~15/min, safe for AI-Gateway
// free tier).
const FAST_PARALLEL = 3
const SLOW_PARALLEL = 1
const SLOW_DELAY_MS = 4_000
const FAILURE_TOAST_CAP = 8

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

export type ProcessRunFilters = {
  scope: "org" | "system"
  sourceId?: string
  // Filename / metadata ILIKE search (matches the table's `q`).
  filenameSearch?: string
  dateFromIso?: string
  dateToIso?: string
}

export type ProcessRunOptions = {
  slow?: boolean
  // Shown in toasts/progress so a sync-triggered run can say which
  // source it's draining ("Telegram: обработка…").
  label?: string
}

export type ProcessProgress = {
  done: number
  total: number
  failed: number
  label?: string
}

// Shared parse→upload batch runner. Owns the run lifecycle (cancel,
// progress, toasts) so BOTH the table's "Обработать все" control and the
// per-source "Синхронизировать и обработать" buttons drive the same
// loop and the same progress bar — only one run at a time.
//
// Each item is one bounded HTTP call to `/process` (parse + upload +
// child-ship, all idempotent server-side), so cancelling mid-run or
// closing the tab never corrupts state: every row's real status is on
// the row, and re-running resumes from wherever it stopped.
export function useProcessRun({ onRefresh }: { onRefresh: () => void }) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ProcessProgress | null>(null)
  const cancelRef = useRef(false)

  const buildQuery = useCallback((filters: ProcessRunFilters) => {
    const params = new URLSearchParams()
    if (filters.scope === "system") params.set("scope", "system")
    if (filters.sourceId) params.set("sourceId", filters.sourceId)
    if (filters.filenameSearch && filters.filenameSearch.trim()) {
      params.set("q", filters.filenameSearch.trim())
    }
    if (filters.dateFromIso) params.set("date_from", filters.dateFromIso)
    if (filters.dateToIso) params.set("date_to", filters.dateToIso)
    return params.toString()
  }, [])

  const processOne = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch(`/api/sources/items/${id}/process`, {
          method: "POST",
        })
        const data = await res.json()
        if (!res.ok) {
          return { ok: false, error: data.error || "Ошибка обработки" }
        }
        // processSourceItem returns HTTP 200 with `ok`/`error` on the body
        // even when the item didn't fully succeed (batch-safety contract).
        if (data?.ok === false) {
          return { ok: false, error: data?.error || "Ошибка обработки" }
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [],
  )

  const run = useCallback(
    async (filters: ProcessRunFilters, opts: ProcessRunOptions = {}) => {
      if (running) {
        toast.message("Обработка уже выполняется — дождитесь завершения")
        return
      }
      cancelRef.current = false
      setRunning(true)

      const prefix = opts.label ? `${opts.label}: ` : ""

      let ids: string[] = []
      let total = 0
      try {
        const res = await fetch(
          `/api/sources/items/process-ids?${buildQuery(filters)}`,
        )
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || "Не удалось получить список элементов")
        }
        ids = (data.ids ?? []) as string[]
        total = (data.total ?? ids.length) as number
      } catch (err) {
        toast.error(
          `${prefix}${err instanceof Error ? err.message : "Неизвестная ошибка"}`,
        )
        setRunning(false)
        return
      }

      if (ids.length === 0) {
        toast.message(`${prefix}нечего обрабатывать`)
        setRunning(false)
        return
      }

      setProgress({ done: 0, total: ids.length, failed: 0, label: opts.label })
      const failures: { id: string; error: string }[] = []

      const parallel = opts.slow ? SLOW_PARALLEL : FAST_PARALLEL
      const interChunkDelayMs = opts.slow ? SLOW_DELAY_MS : 0

      for (let i = 0; i < ids.length; i += parallel) {
        if (cancelRef.current) break
        const chunk = ids.slice(i, i + parallel)
        const outcomes = await Promise.all(chunk.map((id) => processOne(id)))
        let failedThisChunk = 0
        for (let j = 0; j < outcomes.length; j++) {
          if (!outcomes[j].ok) {
            failedThisChunk++
            failures.push({ id: chunk[j], error: outcomes[j].error ?? "unknown" })
          }
        }
        setProgress((prev) =>
          prev
            ? {
                ...prev,
                done: prev.done + chunk.length,
                failed: prev.failed + failedThisChunk,
              }
            : prev,
        )
        // Live-refresh the table so rows flip badges as they complete.
        onRefresh()

        if (interChunkDelayMs > 0 && i + parallel < ids.length) {
          if (cancelRef.current) break
          await sleep(interChunkDelayMs)
        }
      }

      const cancelled = cancelRef.current
      const ok = ids.length - failures.length

      if (cancelled) {
        toast.message(`${prefix}отменено — обработано ${ok} из ${ids.length}`)
      } else if (failures.length === 0) {
        toast.success(
          `${prefix}обработано ${ids.length} ${plural(ids.length, ["элемент", "элемента", "элементов"])}`,
        )
      } else {
        toast.success(
          `${prefix}обработано ${ok} ${plural(ok, ["элемент", "элемента", "элементов"])}`,
        )
        for (const f of failures.slice(0, FAILURE_TOAST_CAP)) {
          toast.error(`${f.id.slice(0, 8)}…: ${f.error}`)
        }
        if (failures.length > FAILURE_TOAST_CAP) {
          toast.error(
            `…и ещё ${failures.length - FAILURE_TOAST_CAP} ошибок (остались со статусом «Ошибка»)`,
          )
        }
      }

      if (!cancelled && total > ids.length) {
        toast.message(
          `Ещё ${total - ids.length} строк подходят — запустите «Обработать все» снова для следующей партии`,
        )
      }

      setRunning(false)
      setProgress(null)
      cancelRef.current = false
      onRefresh()
    },
    [running, buildQuery, processOne, onRefresh],
  )

  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  return { running, progress, run, cancel, cancelRequested: cancelRef }
}
