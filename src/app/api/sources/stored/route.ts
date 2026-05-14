import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  listOrgStoredContent,
  type StoredContentMimeBucket,
} from "@/server/source-items"
import { getActiveOrgRole } from "@/server/sources"
import type { ParseStatus, R2UploadStatus } from "@/db/schema"

const PARSE_STATUSES: ParseStatus[] = [
  "pending",
  "processing",
  "complete",
  "failed",
  "skipped",
]
const R2_UPLOAD_STATUSES: R2UploadStatus[] = ["pending", "complete", "failed"]
const MIME_BUCKETS: StoredContentMimeBucket[] = [
  "pdf",
  "image",
  "audio",
  "video",
  "office",
  "other",
]

// Default sliding window when the caller doesn't pin date_from. Seven
// days back from "now" matches the user's spec for the Stored Content
// tab and keeps the listing bounded by default — useful since this view
// has no parseStatus pre-filter.
const DEFAULT_WINDOW_DAYS = 7

// Stored Content listing — admin OR org-owner only. Members see the
// per-org Pending / Processed tabs but not this richer audit view.
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const isAdmin = session.user?.role === "admin"
  let isOrgOwner = false
  if (!isAdmin) {
    const role = await getActiveOrgRole()
    isOrgOwner = role?.role === "owner"
  }
  if (!isAdmin && !isOrgOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)

  const sourceId = searchParams.get("sourceId") ?? undefined
  const filenameSearch = searchParams.get("q") ?? undefined

  const mimeRaw = searchParams.get("mime") as StoredContentMimeBucket | null
  const mimeBucket =
    mimeRaw && MIME_BUCKETS.includes(mimeRaw) ? mimeRaw : undefined

  const parseRaw = searchParams.get("parse_status") as ParseStatus | null
  const parseStatus =
    parseRaw && PARSE_STATUSES.includes(parseRaw) ? parseRaw : undefined

  const uploadRaw = searchParams.get("upload_status") as R2UploadStatus | null
  const r2UploadStatus =
    uploadRaw && R2_UPLOAD_STATUSES.includes(uploadRaw) ? uploadRaw : undefined

  // Date range params — inclusive day boundaries in UTC (same convention
  // as /api/sources/items). `date_from` covers items from 00:00:00 of
  // that day; `date_to` covers items up to 23:59:59 of that day.
  const dateFromStr = searchParams.get("date_from")
  const dateToStr = searchParams.get("date_to")
  let dateFrom: Date | undefined
  let dateTo: Date | undefined
  if (dateFromStr) dateFrom = new Date(`${dateFromStr}T00:00:00.000Z`)
  if (dateToStr) dateTo = new Date(`${dateToStr}T23:59:59.999Z`)
  if (!dateFromStr && !dateToStr) {
    // No range pinned by caller → apply the default sliding window.
    // Anchored on "now" so the window slides forward day to day; the
    // table's pagination caches a snapshot but a manual refresh re-pins.
    const now = new Date()
    dateTo = new Date(now)
    dateTo.setUTCHours(23, 59, 59, 999)
    dateFrom = new Date(now)
    dateFrom.setUTCDate(dateFrom.getUTCDate() - DEFAULT_WINDOW_DAYS)
    dateFrom.setUTCHours(0, 0, 0, 0)
  }

  const limit = Number.parseInt(searchParams.get("limit") ?? "10", 10)
  const offset = Number.parseInt(searchParams.get("offset") ?? "0", 10)

  try {
    const result = await listOrgStoredContent({
      organizationId: activeOrgId,
      sourceId,
      mimeBucket,
      filenameSearch,
      parseStatus,
      r2UploadStatus,
      dateFrom,
      dateTo,
      limit: Number.isFinite(limit) ? limit : 10,
      offset: Number.isFinite(offset) ? offset : 0,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[sources/stored] Error:", error)
    const message =
      error instanceof Error ? error.message : "Failed to list stored content"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
