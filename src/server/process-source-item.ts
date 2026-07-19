import "server-only"

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  sourceItem,
  type ParseStatus,
  type R2UploadStatus,
} from "@/db/schema"
import { parseSourceItem } from "@/server/parse-source-item"
import { uploadSourceItem } from "@/server/r2/upload-source-item"

// One end-to-end "process" of a single source_item: parse (if it still
// needs it) → upload its markdown to R2 (if parsed) → upload any child
// rows the parse just produced (attachments / derived audio of a root).
//
// This is the manual-UI counterpart to the daily cron pipeline, scoped
// to one item. It reuses the exact same building blocks the cron uses
// (`parseSourceItem` + `uploadSourceItem`), so behaviour can't drift
// between the two paths. Like both of those, it NEVER throws — every
// failure is captured on the durable status columns and reflected in the
// returned summary, so the client batch loop can isolate per-item
// failures and the operator can simply re-run to resume.
//
// Idempotent / resumable by construction:
//   • parse already complete/skipped → parse step is skipped.
//   • parsed but upload failed earlier → only the upload is retried (no
//     wasted LLM spend re-parsing).
//   • a root whose children failed to ship → re-running the root (or the
//     child directly) retries just the outstanding uploads.
export type ProcessResult = {
  sourceItemId: string
  // Final durable state after this run.
  parseStatus: ParseStatus | "not_found"
  r2UploadStatus: R2UploadStatus | "not_found"
  // Whether each step actually ran this call (vs. skipped as already-done).
  parsed: boolean
  uploaded: boolean
  childrenUploaded: number
  childrenFailed: number
  // True when the item reached a terminal-good state for its kind:
  // 'skipped' (nothing to ship) OR parse complete + uploaded, with no
  // failed child uploads.
  ok: boolean
  // First meaningful failure message, when not ok.
  error?: string
}

type Row = {
  parseStatus: ParseStatus
  r2UploadStatus: R2UploadStatus
  parentSourceItemId: string | null
}

async function loadRow(itemId: string): Promise<Row | null> {
  const rows = await db
    .select({
      parseStatus: sourceItem.parseStatus,
      r2UploadStatus: sourceItem.r2UploadStatus,
      parentSourceItemId: sourceItem.parentSourceItemId,
    })
    .from(sourceItem)
    .where(eq(sourceItem.id, itemId))
    .limit(1)
  return rows[0] ?? null
}

export async function processSourceItem(
  itemId: string,
): Promise<ProcessResult> {
  const initial = await loadRow(itemId)
  if (!initial) {
    return {
      sourceItemId: itemId,
      parseStatus: "not_found",
      r2UploadStatus: "not_found",
      parsed: false,
      uploaded: false,
      childrenUploaded: 0,
      childrenFailed: 0,
      ok: false,
      error: "Source item not found",
    }
  }

  // ── 1. Parse, if it still needs parsing ────────────────────────────
  // 'complete'/'skipped' are terminal parse states; everything else
  // (pending / processing / failed) is re-runnable. Guarding on this
  // also keeps us from calling parseSourceItem for providers whose rows
  // arrive pre-parsed and whose parser throws (dropoff / aichat) — those
  // are always already 'complete'.
  let parsed = false
  let parseError: string | undefined
  if (initial.parseStatus !== "complete" && initial.parseStatus !== "skipped") {
    parsed = true
    try {
      const r = await parseSourceItem(itemId)
      if (r.parentStatus === "failed") {
        parseError = r.parentParseError ?? "Ошибка разбора"
      }
    } catch (err) {
      // parseSourceItem is contracted to return normally, but belt-and-
      // braces: a throw here must not abort the upload of siblings in a
      // batch loop.
      parseError = err instanceof Error ? err.message : String(err)
    }
  }

  const afterParse = (await loadRow(itemId)) ?? initial

  // ── 2. Upload this item, if parsed and not yet shipped ─────────────
  let uploaded = false
  let uploadError: string | undefined
  if (
    afterParse.parseStatus === "complete" &&
    afterParse.r2UploadStatus !== "complete"
  ) {
    const u = await uploadSourceItem(itemId)
    if (u.ok) uploaded = true
    else uploadError = u.error
  }

  // ── 3. Upload child rows a fresh root parse just produced ──────────
  // Children (attachments, derived audio) are inserted by the parent's
  // parse already 'complete' but unshipped. Shipping them here makes a
  // single row-level "process" fully drain a root + its attachments.
  // (Standalone children also surface directly in the work-set, so they
  // get covered by step 2 when processed on their own.)
  let childrenUploaded = 0
  let childrenFailed = 0
  if (afterParse.parentSourceItemId === null) {
    const children = await db
      .select({ id: sourceItem.id })
      .from(sourceItem)
      .where(
        and(
          eq(sourceItem.parentSourceItemId, itemId),
          eq(sourceItem.parseStatus, "complete"),
          inArray(sourceItem.r2UploadStatus, ["pending", "failed"]),
        ),
      )
    for (const child of children) {
      const u = await uploadSourceItem(child.id)
      if (u.ok) childrenUploaded++
      else childrenFailed++
    }
  }

  const final = (await loadRow(itemId)) ?? afterParse

  const ok =
    final.parseStatus === "skipped" ||
    (final.parseStatus === "complete" &&
      final.r2UploadStatus === "complete" &&
      childrenFailed === 0)

  const error = ok
    ? undefined
    : parseError ??
      uploadError ??
      (childrenFailed > 0
        ? `Не удалось загрузить вложений: ${childrenFailed}`
        : `Обработка не завершена (разбор: ${final.parseStatus}, загрузка: ${final.r2UploadStatus})`)

  return {
    sourceItemId: itemId,
    parseStatus: final.parseStatus,
    r2UploadStatus: final.r2UploadStatus,
    parsed,
    uploaded,
    childrenUploaded,
    childrenFailed,
    ok,
    error,
  }
}
