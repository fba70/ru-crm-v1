"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { CloudUpload, Loader, X } from "lucide-react"
import { toast } from "sonner"

// Concurrency for parallel R2 puts. R2 ops are independent; 5-wide
// hits a sweet spot between throughput (faster than serial) and not
// pegging the user's uplink or tripping any rate-limit headers.
const PARALLEL = 5

// How often the count refreshes when no batch is running. Cheap
// indicator endpoint (count + 500 ids), so polling at this cadence
// is fine. Bumped on demand via `refreshKey` prop for instant updates
// after parse / re-parse / sync events change the eligible set.
const COUNT_POLL_MS = 30_000

const FAILURE_TOAST_CAP = 8

// Same scope keys the listing endpoints use — kept in sync so the
// control's "Upload all (N)" matches what the user sees in the table.
type Scope = "org" | "system"

export type R2BatchUploadFilters = {
  scope: Scope
  sourceId?: string
  // Filename ILIKE search. Maps to `q` on the endpoint.
  filenameSearch?: string
  // Stored Content's mime-bucket filter. Pending/Processed callers
  // omit this; Stored Content callers pass through the user's choice.
  mimeBucket?: "pdf" | "image" | "audio" | "video" | "office" | "other"
  dateFromIso?: string // YYYY-MM-DD (UTC day boundary applied server-side)
  dateToIso?: string
}

// Top-of-table "Upload all to R2 (N)" control. Shows a count of
// eligible rows in the current filter context; on click drives a
// parallel-chunk upload loop with a progress bar + cancel button.
//
// Hidden when N = 0 so an empty queue doesn't take up space. The
// parent passes `onActionComplete` so each chunk can bump the table
// refreshKey and the per-row badges flip from "Needs upload" → "Done"
// while the batch is still running.
export function R2BatchUploadControl({
  filters,
  refreshKey,
  onActionComplete,
}: {
  filters: R2BatchUploadFilters
  // Bumped externally by the parent table whenever rows might have
  // changed (sync / per-row Parse / re-parse). Re-fetches the count.
  refreshKey: number
  onActionComplete: () => void
}) {
  const [count, setCount] = useState(0)
  const [cap, setCap] = useState(500)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{
    done: number
    total: number
    failed: number
  } | null>(null)

  // Cancel signal — set to true on cancel click; the chunk loop reads
  // it at every chunk boundary and breaks out. In-flight uploads in
  // the current chunk complete (R2 puts are atomic — no point aborting
  // the fetch since the side effect is already racing).
  const cancelRef = useRef(false)

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams()
    if (filters.scope === "system") params.set("scope", "system")
    if (filters.sourceId) params.set("sourceId", filters.sourceId)
    if (filters.filenameSearch && filters.filenameSearch.trim()) {
      params.set("q", filters.filenameSearch.trim())
    }
    if (filters.mimeBucket) params.set("mime", filters.mimeBucket)
    if (filters.dateFromIso) params.set("date_from", filters.dateFromIso)
    if (filters.dateToIso) params.set("date_to", filters.dateToIso)
    return params.toString()
  }, [filters])

  const fetchCount = useCallback(async () => {
    try {
      const qs = buildQueryString()
      const res = await fetch(`/api/sources/r2/pending-ids?${qs}`)
      const data = await res.json()
      if (!res.ok) return
      setCount(data.total ?? 0)
      if (typeof data.cap === "number") setCap(data.cap)
    } catch {
      // Silent — the count is informational; failed poll just leaves
      // the previous number visible until the next tick.
    }
  }, [buildQueryString])

  useEffect(() => {
    if (running) return
    fetchCount()
    const t = setInterval(fetchCount, COUNT_POLL_MS)
    return () => clearInterval(t)
  }, [fetchCount, running, refreshKey])

  async function uploadOne(
    id: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch("/api/sources/r2/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceItemId: id }),
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data.error || "Upload failed" }
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
    // user's current filter exactly — not a stale poll result.
    let ids: string[] = []
    let total = 0
    try {
      const qs = buildQueryString()
      const res = await fetch(`/api/sources/r2/pending-ids?${qs}`)
      const data = await res.json()
      if (!res.ok)
        throw new Error(data.error || "Failed to list pending uploads")
      ids = (data.ids ?? []) as string[]
      total = (data.total ?? ids.length) as number
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unknown error")
      setRunning(false)
      return
    }

    if (ids.length === 0) {
      toast.message("Nothing to upload — all rows in scope are already in R2")
      setRunning(false)
      return
    }

    setProgress({ done: 0, total: ids.length, failed: 0 })
    const failures: { id: string; error: string }[] = []

    // Process in parallel chunks of PARALLEL. Cancel checked at each
    // chunk boundary; in-flight chunk finishes naturally.
    for (let i = 0; i < ids.length; i += PARALLEL) {
      if (cancelRef.current) break
      const chunk = ids.slice(i, i + PARALLEL)
      const outcomes = await Promise.all(chunk.map((id) => uploadOne(id)))
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
      // Refresh the table after each chunk so the user sees badges
      // flip from "Needs upload" → "Done" live.
      onActionComplete()
    }

    const cancelled = cancelRef.current
    const ok =
      ids.length -
      failures.length -
      (cancelled ? ids.length - (progress?.done ?? 0) : 0)

    if (cancelled) {
      toast.message(
        `Cancelled — ${progress?.done ?? 0} of ${ids.length} processed`,
      )
    } else if (failures.length === 0) {
      toast.success(
        `Uploaded ${ids.length} ${ids.length === 1 ? "item" : "items"} to R2`,
      )
    } else {
      toast.success(`Uploaded ${ok} item${ok === 1 ? "" : "s"} to R2`)
      for (const f of failures.slice(0, FAILURE_TOAST_CAP)) {
        toast.error(`${f.id.slice(0, 8)}…: ${f.error}`)
      }
      if (failures.length > FAILURE_TOAST_CAP) {
        toast.error(
          `…and ${failures.length - FAILURE_TOAST_CAP} more failures (see Processed table)`,
        )
      }
    }

    if (total > ids.length) {
      toast.message(
        `${total - ids.length} more rows match — re-run "Upload all to R2" to process the next batch`,
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

  // Hidden when nothing to do AND not currently running. Once a batch
  // starts we keep the panel mounted for the progress bar.
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
              Uploading to content storage — {progress.done} / {progress.total}
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
    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
      <span className="text-sm text-muted-foreground">
        {count} {count === 1 ? "row" : "rows"} ready for content storage upload
        {count >= cap && ` (showing first ${cap} per click)`}
      </span>
      <Button variant="default" size="sm" className="h-8" onClick={start}>
        <CloudUpload className="h-4 w-4 mr-2" />
        Upload all to content storage ({count})
      </Button>
    </div>
  )
}
