import "server-only"

import { and, desc, gte, lte } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  pipelineRun,
  type PipelineRunStatus,
  type PipelineRunTrigger,
} from "@/db/schema"

// Per-error entry as written by `runDailyPipeline` into
// `pipeline_run.errors_json`. Keep this shape in sync with the writer.
type ErrorEntry = {
  phase: "sync" | "parse" | "upload"
  sourceId?: string
  sourceItemId?: string
  message: string
}

export type PipelineErrorEntryWithRun = ErrorEntry & {
  pipelineRunId: string
  runStartedAt: string
  runTrigger: PipelineRunTrigger
}

export type PipelineRunSummary = {
  id: string
  startedAt: string
  finishedAt: string | null
  trigger: PipelineRunTrigger
  status: PipelineRunStatus
  durationMs: number | null
  syncItemsInserted: number
  parseComplete: number
  uploadSucceeded: number
  parseFailed: number
  uploadFailed: number
  parseSkipped: number
  parseCapped: number
}

export type PipelineStats = {
  totals: {
    // Sum of `sync_items_inserted` — net-new rows pulled from providers.
    itemsFetched: number
    // Sum of `upload_succeeded` — items that made it all the way to R2,
    // i.e. fully done. Per the user's product call, "successfully
    // processed" means in the bucket, not just parsed.
    itemsProcessed: number
    // Sum of `parse_failed + upload_failed`. `parse_skipped` is
    // intentionally excluded — it's a deterministic non-error outcome
    // (oversize attachment, source deleted at provider) and surfaces
    // separately as `itemsSkipped`.
    itemsWithErrors: number
    itemsSkipped: number
    parseCapped: number
    runCount: number
  }
  runs: PipelineRunSummary[]
  errors: PipelineErrorEntryWithRun[]
}

export async function getPipelineStats(
  from: Date,
  to: Date,
): Promise<PipelineStats> {
  const rows = await db
    .select()
    .from(pipelineRun)
    .where(and(gte(pipelineRun.startedAt, from), lte(pipelineRun.startedAt, to)))
    .orderBy(desc(pipelineRun.startedAt))

  let itemsFetched = 0
  let itemsProcessed = 0
  let itemsWithErrors = 0
  let itemsSkipped = 0
  let parseCapped = 0

  const runs: PipelineRunSummary[] = []
  const errors: PipelineErrorEntryWithRun[] = []

  for (const r of rows) {
    itemsFetched += r.syncItemsInserted
    itemsProcessed += r.uploadSucceeded
    itemsWithErrors += r.parseFailed + r.uploadFailed
    itemsSkipped += r.parseSkipped
    parseCapped += r.parseCapped

    const startedAtIso = r.startedAt.toISOString()
    const finishedAtIso = r.finishedAt?.toISOString() ?? null
    const durationMs = r.finishedAt
      ? r.finishedAt.getTime() - r.startedAt.getTime()
      : null

    runs.push({
      id: r.id,
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      trigger: r.trigger,
      status: r.status,
      durationMs,
      syncItemsInserted: r.syncItemsInserted,
      parseComplete: r.parseComplete,
      uploadSucceeded: r.uploadSucceeded,
      parseFailed: r.parseFailed,
      uploadFailed: r.uploadFailed,
      parseSkipped: r.parseSkipped,
      parseCapped: r.parseCapped,
    })

    // errorsJson is jsonb in the DB; Drizzle returns it as `unknown`
    // since the column type is generic. We control the writer so this
    // cast is safe.
    const entries = (r.errorsJson as ErrorEntry[] | null) ?? []
    for (const e of entries) {
      errors.push({
        ...e,
        pipelineRunId: r.id,
        runStartedAt: startedAtIso,
        runTrigger: r.trigger,
      })
    }
  }

  return {
    totals: {
      itemsFetched,
      itemsProcessed,
      itemsWithErrors,
      itemsSkipped,
      parseCapped,
      runCount: rows.length,
    },
    runs,
    errors,
  }
}
