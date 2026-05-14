import "server-only"

import { and, asc, eq, isNotNull, ne } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, sourceItem } from "@/db/schema"

// Eligible-for-upload = parsed rows (parent or child) that haven't
// landed in R2 yet. The query is purely status-based, so it picks up:
//   • Just-parsed rows from this run's parse phase
//   • Drop-off uploads where the user forgot to click Upload
//   • Previously-failed uploads waiting for retry (status='failed')
//
// Excluded:
//   • Rows where parsed_markdown is NULL — already-uploaded rows
//     (markdown was cleared by a prior successful upload), or skipped
//     attachments that have no body to ship. uploadSourceItem would
//     reject these anyway, but filtering here keeps the queue length
//     truthful.
//   • Rows whose parent source has `automatedParsingIsAllowed = false`
//     — same gate as the parse phase. Manual /api/sources/r2/save
//     still works.
//
// Ordered by parsedAt ASC so the oldest waiting items go first.
export async function listPendingUploadIds(limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        eq(sourceItem.parseStatus, "complete"),
        ne(sourceItem.r2UploadStatus, "complete"),
        isNotNull(sourceItem.parsedMarkdown),
        eq(source.automatedParsingIsAllowed, true),
      ),
    )
    .orderBy(asc(sourceItem.parsedAt))
    .limit(limit)
  return rows.map((r) => r.id)
}

export async function countPendingUploadTotal(): Promise<number> {
  const rows = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        eq(sourceItem.parseStatus, "complete"),
        ne(sourceItem.r2UploadStatus, "complete"),
        isNotNull(sourceItem.parsedMarkdown),
        eq(source.automatedParsingIsAllowed, true),
      ),
    )
  return rows.length
}
