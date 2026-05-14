"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader, Sparkles, X } from "lucide-react"
import { toast } from "sonner"

// Concurrency knobs. Default mode: 3-wide parallel parses, no
// inter-call delay — best throughput when the AI Gateway plan can
// keep up. Slow mode: 1-wide + 4s delay between calls, which keeps
// the request rate under ~15 requests/min — safe for the free tier
// of most LLM providers (and Vercel AI Gateway free credits).
const FAST_PARALLEL = 3
const SLOW_PARALLEL = 1
const SLOW_DELAY_MS = 4_000

const COUNT_POLL_MS = 30_000
const FAILURE_TOAST_CAP = 8

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Scope = "org" | "system"

export type ParseBatchFilters = {
  scope: Scope
  sourceId?: string
  // Filename / metadata ILIKE search (matches Pending table's `q`).
  filenameSearch?: string
  dateFromIso?: string
  dateToIso?: string
}

// "Parse all (N)" control mounted at the top of the Pending table.
// Mirrors <R2BatchUploadControl> in shape: shows a count of eligible
// pending rows in the current filter scope, drives a parallel-chunk
// parse loop with a progress bar + cancel. Hidden when N = 0.
//
// Per-row failures are surfaced as toasts (cap at 8 + a "+N more"
// summary) so a catastrophic batch doesn't bury everything else.
// Failed rows stay in Pending with a "Parse failed" badge for
// individual retry via the per-row Re-parse button.
export function ParseBatchControl({
  filters,
  refreshKey,
  onActionComplete,
}: {
  filters: ParseBatchFilters
  refreshKey: number
  onActionComplete: () => void
}) {
  const [count, setCount] = useState(0)
  const [cap, setCap] = useState(500)
  const [running, setRunning] = useState(false)
  const [slowMode, setSlowMode] = useState(false)
  const [progress, setProgress] = useState<{
    done: number
    total: number
    failed: number
  } | null>(null)

  // Cancel flag — checked at every chunk boundary. In-flight LLM
  // calls in the current chunk complete naturally (we don't abort
  // the fetches mid-flight; the parser already wrote `processing`
  // status to the DB, so leaving it to finish is safer than yanking
  // the rug).
  const cancelRef = useRef(false)

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams()
    if (filters.scope === "system") params.set("scope", "system")
    if (filters.sourceId) params.set("sourceId", filters.sourceId)
    if (filters.filenameSearch && filters.filenameSearch.trim()) {
      params.set("q", filters.filenameSearch.trim())
    }
    if (filters.dateFromIso) params.set("date_from", filters.dateFromIso)
    if (filters.dateToIso) params.set("date_to", filters.dateToIso)
    return params.toString()
  }, [filters])

  const fetchCount = useCallback(async () => {
    try {
      const qs = buildQueryString()
      const res = await fetch(
        `/api/sources/items/pending-parse-ids?${qs}`,
      )
      const data = await res.json()
      if (!res.ok) return
      setCount(data.total ?? 0)
      if (typeof data.cap === "number") setCap(data.cap)
    } catch {
      // Silent — count is informational; failed poll just leaves the
      // previous number visible.
    }
  }, [buildQueryString])

  useEffect(() => {
    if (running) return
    fetchCount()
    const t = setInterval(fetchCount, COUNT_POLL_MS)
    return () => clearInterval(t)
  }, [fetchCount, running, refreshKey])

  async function parseOne(
    id: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/sources/items/${id}/parse`, {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data.error || "Parse failed" }
      // parseSourceItem returns HTTP 200 even on failure (the batch-
      // safety contract). Inspect the parentStatus to know if it
      // actually worked.
      if (data?.parentStatus === "failed") {
        return {
          ok: false,
          error: data?.parentParseError || "Parse failed",
        }
      }
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async function start() {
    if (running) return
    cancelRef.current = false
    setRunning(true)

    // Pull the candidate list at click time so the batch reflects the
    // user's exact filter context — not a stale poll result.
    let ids: string[] = []
    let total = 0
    try {
      const qs = buildQueryString()
      const res = await fetch(`/api/sources/items/pending-parse-ids?${qs}`)
      const data = await res.json()
      if (!res.ok)
        throw new Error(data.error || "Failed to list pending items")
      ids = (data.ids ?? []) as string[]
      total = (data.total ?? ids.length) as number
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unknown error")
      setRunning(false)
      return
    }

    if (ids.length === 0) {
      toast.message("Nothing to parse — no pending items in scope")
      setRunning(false)
      return
    }

    setProgress({ done: 0, total: ids.length, failed: 0 })
    const failures: { id: string; error: string }[] = []

    // Read once at start so flipping the toggle mid-batch doesn't
    // cause weird hybrid behavior — the in-flight batch sticks with
    // the mode the user clicked Parse with.
    const parallel = slowMode ? SLOW_PARALLEL : FAST_PARALLEL
    const interChunkDelayMs = slowMode ? SLOW_DELAY_MS : 0

    for (let i = 0; i < ids.length; i += parallel) {
      if (cancelRef.current) break
      const chunk = ids.slice(i, i + parallel)
      const outcomes = await Promise.all(chunk.map((id) => parseOne(id)))
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
      // Refresh after each chunk so the user sees rows leave the
      // Pending table live as parses complete.
      onActionComplete()

      // Slow-mode pacing: hold for SLOW_DELAY_MS between chunks. Skip
      // the wait if we're on the last chunk or the user cancelled.
      if (interChunkDelayMs > 0 && i + parallel < ids.length) {
        if (cancelRef.current) break
        await sleep(interChunkDelayMs)
      }
    }

    const cancelled = cancelRef.current
    const ok = ids.length - failures.length

    if (cancelled) {
      toast.message(
        `Cancelled — ${progress?.done ?? 0} of ${ids.length} attempted`,
      )
    } else if (failures.length === 0) {
      toast.success(
        `Parsed ${ids.length} ${ids.length === 1 ? "item" : "items"}`,
      )
    } else {
      toast.success(`Parsed ${ok} item${ok === 1 ? "" : "s"}`)
      for (const f of failures.slice(0, FAILURE_TOAST_CAP)) {
        toast.error(`${f.id.slice(0, 8)}…: ${f.error}`)
      }
      if (failures.length > FAILURE_TOAST_CAP) {
        toast.error(
          `…and ${failures.length - FAILURE_TOAST_CAP} more failures (still in Pending with "Parse failed")`,
        )
      }
    }

    if (total > ids.length) {
      toast.message(
        `${total - ids.length} more rows match — re-run "Parse all" to process the next batch`,
      )
    }

    setRunning(false)
    setProgress(null)
    cancelRef.current = false
    onActionComplete()
  }

  function cancel() {
    cancelRef.current = true
  }

  if (!running && count === 0) return null

  if (running && progress) {
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
              Parsing — {progress.done} / {progress.total}
              {progress.failed > 0 && (
                <span className="text-destructive ml-2">
                  · {progress.failed} failed
                </span>
              )}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs shrink-0"
            onClick={cancel}
            disabled={cancelRef.current}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            {cancelRef.current ? "Cancelling…" : "Cancel"}
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

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 flex-wrap">
      <span className="text-xs text-muted-foreground">
        {count} {count === 1 ? "item" : "items"} ready to parse
        {count >= cap && ` (showing first ${cap} per click)`}
      </span>
      <div className="flex items-center gap-3 flex-wrap">
        <label
          className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer"
          title="Sequential, with a 4-second delay between calls. Use this on free-tier credits to stay under the AI Gateway rate limit."
        >
          <Checkbox
            checked={slowMode}
            onCheckedChange={(v) => setSlowMode(v === true)}
          />
          Slow mode (free-tier safe)
        </label>
        <Button variant="default" size="sm" className="h-8" onClick={start}>
          <Sparkles className="h-4 w-4 mr-2" />
          Parse all ({count})
        </Button>
      </div>
    </div>
  )
}
