import "server-only"

import { eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { sourceItem } from "@/db/schema"
import { putMarkdownToR2 } from "@/lib/r2"

// Result of a single uploadSourceItem call. Both branches are
// non-throwing — the caller (manual route OR daily pipeline) decides
// whether to surface or aggregate the failure. Mirrors the contract of
// `parseSourceItem` so the orchestration layer can treat parse + upload
// uniformly.
export type UploadResult =
  | {
      ok: true
      sourceItemId: string
      key: string
      sizeBytes: number
      uploadedAt: Date
    }
  | {
      ok: false
      sourceItemId: string
      // 'not_found' / 'not_parsed' / 'no_markdown' are precondition
      // failures — the row isn't ready and we didn't touch R2 or update
      // status. 'r2_failed' means the actual upload threw, in which case
      // r2UploadStatus is set to 'failed' so the row shows the right
      // badge and is eligible for retry next run.
      reason: "not_found" | "not_parsed" | "no_markdown" | "r2_failed"
      error: string
    }

// Upload a parsed source_item's markdown to R2 and stamp the upload-side
// columns on the row. Single source of truth for the upload step — used
// by both the manual `/api/sources/r2/save` route and the daily pipeline.
//
// Org derivation: the R2 key prefix is taken from `source_item.organization_id`
// (which is denormalised from `source.owner_organization_id` at sync
// time — null for system sources). The previous route used the admin's
// active session org which is irrelevant for cron-triggered runs and
// can drift from the row's actual owner — row-derived is canonical.
export async function uploadSourceItem(
  sourceItemId: string,
): Promise<UploadResult> {
  const rows = await db
    .select({
      id: sourceItem.id,
      sourceId: sourceItem.sourceId,
      organizationId: sourceItem.organizationId,
      parseStatus: sourceItem.parseStatus,
      parsedMarkdown: sourceItem.parsedMarkdown,
      markdownR2Key: sourceItem.markdownR2Key,
    })
    .from(sourceItem)
    .where(eq(sourceItem.id, sourceItemId))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return {
      ok: false,
      sourceItemId,
      reason: "not_found",
      error: "Source item not found",
    }
  }
  if (row.parseStatus !== "complete") {
    return {
      ok: false,
      sourceItemId,
      reason: "not_parsed",
      error: `Cannot upload — parseStatus is '${row.parseStatus}'`,
    }
  }
  if (!row.parsedMarkdown) {
    return {
      ok: false,
      sourceItemId,
      reason: "no_markdown",
      error: row.markdownR2Key
        ? "Already uploaded — re-parse to upload again"
        : "No parsed markdown to upload",
    }
  }

  // Org segment: 'org_<id>' for org-owned rows, 'org_system' for system
  // sources where organization_id is null. Keeps the bucket layout flat
  // and grep-able instead of producing a literal 'org_null' path.
  const orgSegment = row.organizationId ? `org_${row.organizationId}` : "org_system"
  const key = `${orgSegment}/source_${row.sourceId}/item_${row.id}.md`

  try {
    const uploaded = await putMarkdownToR2(key, row.parsedMarkdown)
    const now = new Date()
    await db
      .update(sourceItem)
      .set({
        r2UploadStatus: "complete",
        r2UploadedAt: now,
        markdownR2Key: uploaded.key,
        markdownR2SizeBytes: uploaded.sizeBytes,
        // R2 has the canonical copy now — drop the DB-side cache.
        parsedMarkdown: null,
      })
      .where(eq(sourceItem.id, row.id))
    return {
      ok: true,
      sourceItemId: row.id,
      key: uploaded.key,
      sizeBytes: uploaded.sizeBytes,
      uploadedAt: now,
    }
  } catch (err) {
    console.error("[uploadSourceItem] R2 put failed", { sourceItemId, err })
    await db
      .update(sourceItem)
      .set({ r2UploadStatus: "failed" })
      .where(eq(sourceItem.id, row.id))
    return {
      ok: false,
      sourceItemId: row.id,
      reason: "r2_failed",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
