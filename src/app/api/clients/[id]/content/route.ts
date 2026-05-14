import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  ClientContentScopeError,
  listClientContent,
} from "@/server/client-content"
import type { StoredContentMimeBucket } from "@/server/source-items"

const MIME_BUCKETS: StoredContentMimeBucket[] = [
  "pdf",
  "image",
  "audio",
  "video",
  "office",
  "other",
]

// Per-client content listing — see `src/server/client-content.ts` for
// the matching rule. Tenant-scoped on the active org. The route accepts
// a subset of the Stored Content filters: source / mime / q / date
// range. Parse + upload status are pinned server-side ("complete",
// "complete") since this view only shows R2-backed rows.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: clientId } = await params
  if (!clientId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)

  const sourceId = searchParams.get("sourceId") ?? undefined
  const q = searchParams.get("q") ?? undefined

  const mimeRaw = searchParams.get("mime") as StoredContentMimeBucket | null
  const mimeBucket =
    mimeRaw && MIME_BUCKETS.includes(mimeRaw) ? mimeRaw : undefined

  const dateFromStr = searchParams.get("date_from")
  const dateToStr = searchParams.get("date_to")
  let dateFrom: Date | undefined
  let dateTo: Date | undefined
  if (dateFromStr) dateFrom = new Date(`${dateFromStr}T00:00:00.000Z`)
  if (dateToStr) dateTo = new Date(`${dateToStr}T23:59:59.999Z`)

  const limit = Number.parseInt(searchParams.get("limit") ?? "5", 10)
  const offset = Number.parseInt(searchParams.get("offset") ?? "0", 10)

  try {
    const result = await listClientContent({
      organizationId: activeOrgId,
      clientId,
      sourceId,
      mimeBucket,
      q,
      dateFrom,
      dateTo,
      limit: Number.isFinite(limit) ? limit : 5,
      offset: Number.isFinite(offset) ? offset : 0,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ClientContentScopeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 403 },
      )
    }
    console.error("[clients/content] Error:", error)
    const message =
      error instanceof Error ? error.message : "Failed to list client content"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
