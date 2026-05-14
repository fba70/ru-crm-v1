import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  listPendingR2UploadIds,
  type StoredContentMimeBucket,
} from "@/server/source-items"

const MIME_BUCKETS: StoredContentMimeBucket[] = [
  "pdf",
  "image",
  "audio",
  "video",
  "office",
  "other",
]

// Returns ids of org's items eligible for R2 upload — i.e. parsed
// rows whose markdown isn't yet in R2. Powers the "Upload all to R2"
// control on the Processed and Stored Content tables. Caller passes
// the same filter context the table is currently showing so the
// batch matches what the user can see.
//
// Auth: any authenticated session with an active org (matches the
// per-row Upload affordance — if you can see the row you can ship it).
// The actual upload step (`/api/sources/r2/save`) re-verifies tenant
// scope per item, so this endpoint just narrows the candidate list.
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)

  // `scope=system` opts into the platform-wide bucket (org_id IS NULL).
  // Default = caller's active org.
  const scopeParam = searchParams.get("scope")
  const scope = scopeParam === "system" ? "system" : "org"
  const organizationId = scope === "system" ? null : activeOrgId

  const sourceId = searchParams.get("sourceId") ?? undefined
  const filenameSearch = searchParams.get("q") ?? undefined

  const mimeRaw = searchParams.get("mime") as StoredContentMimeBucket | null
  const mimeBucket =
    mimeRaw && MIME_BUCKETS.includes(mimeRaw) ? mimeRaw : undefined

  // Same UTC inclusive-day-boundary convention as /api/sources/items
  // and /api/sources/stored.
  const dateFromStr = searchParams.get("date_from")
  const dateToStr = searchParams.get("date_to")
  const dateFrom = dateFromStr ? new Date(`${dateFromStr}T00:00:00.000Z`) : undefined
  const dateTo = dateToStr ? new Date(`${dateToStr}T23:59:59.999Z`) : undefined

  try {
    const result = await listPendingR2UploadIds({
      organizationId,
      scope,
      sourceId,
      filenameSearch,
      mimeBucket,
      dateFrom,
      dateTo,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[r2/pending-ids] Error:", error)
    const message =
      error instanceof Error ? error.message : "Failed to list pending uploads"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
