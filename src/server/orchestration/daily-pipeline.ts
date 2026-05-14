import "server-only"

import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { pipelineRun, sourceItem, type PipelineRunTrigger } from "@/db/schema"
import { parseSourceItem } from "@/server/parse-source-item"
import { uploadSourceItem } from "@/server/r2/upload-source-item"
import { runFullSync } from "./run-full-sync"
import {
  countPendingParseTotal,
  listPendingParseIds,
} from "./parse-pending"
import { listPendingUploadIds } from "./upload-pending"
import { ORCHESTRATION_CONFIG } from "./config"

// Engine-agnostic orchestration entry point. Called by:
//   • The Vercel Workflow (cron-triggered) — wraps this in workflow steps.
//   • The admin "Run pipeline now" route (manual trigger).
//   • Any future scheduler we swap Vercel for — same function.
//
// Sequential execution by design (PHASE2 #2 user decision: MVP doesn't
// have enough volume to need parallelism, and serial keeps Gemini cost
// predictable).
//
// Per-item failure isolation is layered:
//   1. parseSourceItem already returns normally on every error path.
//   2. uploadSourceItem mirrors that contract.
//   3. The for-loops below ALSO wrap each call in try/catch so a
//      programming bug in either function only kills its own iteration.
// Result: one bad row never poisons the batch (PHASE2 #8 user requirement).
export type RunPipelineOptions = {
  trigger: PipelineRunTrigger
}

export type RunPipelineResult = {
  pipelineRunId: string
  status: "success" | "failed"
  startedAt: Date
  finishedAt: Date
  // Useful for admin trigger response — full counts come from the DB row.
  syncSourcesAttempted: number
  parseAttempted: number
  uploadAttempted: number
}

type PipelineErrorEntry = {
  phase: "sync" | "parse" | "upload"
  sourceId?: string
  sourceItemId?: string
  message: string
}

// Push an error into the bounded buffer. Once we hit
// `maxErrorsPerRun`, drop further entries silently except for a single
// "+N more" marker so the column doesn't bloat on a catastrophic run.
function pushError(buffer: PipelineErrorEntry[], entry: PipelineErrorEntry) {
  const cap = ORCHESTRATION_CONFIG.maxErrorsPerRun
  if (buffer.length < cap) {
    buffer.push(entry)
    return
  }
  // Replace the last slot with a running tally instead of appending.
  const lastIdx = buffer.length - 1
  const last = buffer[lastIdx]
  if (last && last.phase === entry.phase && last.message.startsWith("+")) {
    const m = last.message.match(/^\+(\d+) more truncated/)
    const n = m ? parseInt(m[1], 10) + 1 : 1
    buffer[lastIdx] = {
      phase: entry.phase,
      message: `+${n} more truncated`,
    }
  } else {
    buffer.push({ phase: entry.phase, message: "+1 more truncated" })
  }
}

export async function runDailyPipeline(
  opts: RunPipelineOptions,
): Promise<RunPipelineResult> {
  const pipelineRunId = randomUUID()
  const startedAt = new Date()
  await db.insert(pipelineRun).values({
    id: pipelineRunId,
    startedAt,
    trigger: opts.trigger,
    status: "running",
  })

  const errors: PipelineErrorEntry[] = []

  // ── Phase 1: Sync ─────────────────────────────────────────────────
  // runFullSync already isolates per-source failures; we only have to
  // copy its outcomes into the error log.
  const syncResult = await runFullSync()
  for (const o of syncResult.perSource) {
    if (!o.ok) {
      pushError(errors, {
        phase: "sync",
        sourceId: o.sourceId,
        message: `${o.sourceName} (${o.provider}): ${o.error}`,
      })
    }
  }

  // ── Phase 2: Parse ────────────────────────────────────────────────
  const parseEligible = await countPendingParseTotal()
  const parseIds = await listPendingParseIds(
    ORCHESTRATION_CONFIG.maxParsePerRun,
  )
  let parseAttempted = 0
  let parseComplete = 0
  let parseSkipped = 0
  let parseFailed = 0
  for (const id of parseIds) {
    parseAttempted++
    try {
      const r = await parseSourceItem(id)
      if (r.parentStatus === "complete") parseComplete++
      else if (r.parentStatus === "skipped") parseSkipped++
      else if (r.parentStatus === "failed") {
        parseFailed++
        // Snapshot parse_error now — a manual Re-parse on the same row
        // resets parseError to null on the next attempt, so a pointer
        // like "see source_item.parse_error" loses its referent the
        // moment someone clicks the button. Copy the message into
        // errors_json so the widget keeps the original failure text.
        const errRow = await db
          .select({ parseError: sourceItem.parseError })
          .from(sourceItem)
          .where(eq(sourceItem.id, id))
          .limit(1)
        pushError(errors, {
          phase: "parse",
          sourceItemId: id,
          message: errRow[0]?.parseError ?? "(no parse_error recorded)",
        })
      }
    } catch (err) {
      // parseSourceItem is supposed to return normally on every error
      // path. If we end up here, it's a bug in the parser plumbing
      // itself — don't let it kill the loop.
      parseFailed++
      pushError(errors, {
        phase: "parse",
        sourceItemId: id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  const parseCapped = Math.max(0, parseEligible - parseAttempted)

  // ── Phase 3: Upload ───────────────────────────────────────────────
  // Run AFTER parse so the same daily run picks up the rows it just
  // parsed. The cap intentionally applies separately — upload is fast,
  // so a higher ceiling is safe.
  const uploadIds = await listPendingUploadIds(
    ORCHESTRATION_CONFIG.maxUploadPerRun,
  )
  let uploadAttempted = 0
  let uploadSucceeded = 0
  let uploadFailed = 0
  for (const id of uploadIds) {
    uploadAttempted++
    try {
      const r = await uploadSourceItem(id)
      if (r.ok) uploadSucceeded++
      else {
        uploadFailed++
        pushError(errors, {
          phase: "upload",
          sourceItemId: id,
          message: `${r.reason}: ${r.error}`,
        })
      }
    } catch (err) {
      uploadFailed++
      pushError(errors, {
        phase: "upload",
        sourceItemId: id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  // Note: we don't fold uncapped `countPendingUploadTotal()` into the
  // run row — upload eligibility shifts during phase 2 (every successful
  // parse adds new candidates) so a pre-phase-2 count would be wrong.
  // The cap behaviour is implicit in `uploadAttempted` vs the constant.

  // ── Finalise ──────────────────────────────────────────────────────
  const finishedAt = new Date()
  // 'failed' = we recorded any error, 'success' otherwise. Per the
  // user's requirement, even partial-success runs should record the
  // detail for the future widget — `errors_json` holds the breakdown.
  const status: "success" | "failed" = errors.length === 0 ? "success" : "failed"

  await db
    .update(pipelineRun)
    .set({
      finishedAt,
      status,
      syncSourcesTotal: syncResult.totalsourcesAttempted,
      syncSourcesSucceeded: syncResult.totalSourcesSucceeded,
      syncSourcesFailed: syncResult.totalSourcesFailed,
      syncItemsInserted: syncResult.totalItemsInserted,
      syncItemsUpdated: syncResult.totalItemsUpdated,
      parseAttempted,
      parseComplete,
      parseSkipped,
      parseFailed,
      parseCapped,
      uploadAttempted,
      uploadSucceeded,
      uploadFailed,
      errorsJson: errors,
    })
    .where(eq(pipelineRun.id, pipelineRunId))

  return {
    pipelineRunId,
    status,
    startedAt,
    finishedAt,
    syncSourcesAttempted: syncResult.totalsourcesAttempted,
    parseAttempted,
    uploadAttempted,
  }
}
