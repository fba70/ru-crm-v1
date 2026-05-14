import "server-only"

import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, sourceItem } from "@/db/schema"

// Pending = root rows (no parent) whose parse status is 'pending'.
//
// Excluded by design:
//  - 'processing' → another worker / manual click is mid-parse, skip
//    to avoid double-work (PHASE2 #3 guidance from the user: "easiest
//    is to skip rows in processing status").
//  - 'failed' → leave for human triage (PHASE2 #5: skip on daily run,
//    don't auto-retry buggy rows).
//  - children → recreated by their parent's parse, never picked
//    independently.
//  - rows whose parent source has `automatedParsingIsAllowed = false` →
//    org-owner / admin has explicitly disabled cron processing for that
//    source. Manual /api/sources/items/[id]/parse still works.
//
// Ordered by sourceCreatedAt ASC so the oldest waiting items are
// handled first, regardless of which sync surfaced them. `limit` caps
// the per-run cost (`ORCHESTRATION_CONFIG.maxParsePerRun`).
export async function listPendingParseIds(limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        eq(sourceItem.parseStatus, "pending"),
        isNull(sourceItem.parentSourceItemId),
        eq(source.automatedParsingIsAllowed, true),
      ),
    )
    .orderBy(asc(sourceItem.sourceCreatedAt))
    .limit(limit)
  return rows.map((r) => r.id)
}

// Total backlog (ignoring the cap) — used by the pipeline_run row to
// compute `parse_capped` (= eligible − attempted). Same source-flag
// filter as listPendingParseIds so the cap math reflects what the loop
// will actually consider.
export async function countPendingParseTotal(): Promise<number> {
  const rows = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        eq(sourceItem.parseStatus, "pending"),
        isNull(sourceItem.parentSourceItemId),
        eq(source.automatedParsingIsAllowed, true),
      ),
    )
  return rows.length
}
