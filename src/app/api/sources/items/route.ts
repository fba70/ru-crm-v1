import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  listSourceItems,
  type SourceItemListStatus,
  type SourceItemView,
} from "@/server/source-items"

const VIEWS: SourceItemView[] = ["needs_work", "done", "errors", "all"]

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)

  // Unified table sends `view`; the legacy pending/processed split sends
  // `status`. Exactly one is required.
  const viewParam = searchParams.get("view")
  const statusParam = searchParams.get("status")
  let view: SourceItemView | undefined
  let status: SourceItemListStatus | undefined
  if (viewParam) {
    if (!VIEWS.includes(viewParam as SourceItemView)) {
      return NextResponse.json(
        { error: "view must be one of needs_work | done | errors | all" },
        { status: 400 },
      )
    }
    view = viewParam as SourceItemView
  } else if (statusParam === "pending" || statusParam === "processed") {
    status = statusParam
  } else {
    return NextResponse.json(
      { error: "provide `view` or `status` (pending|processed)" },
      { status: 400 },
    )
  }

  const sourceId = searchParams.get("sourceId") ?? undefined
  const q = searchParams.get("q") ?? undefined
  const dateFromStr = searchParams.get("date_from")
  const dateToStr = searchParams.get("date_to")
  const limit = Number.parseInt(searchParams.get("limit") ?? "25", 10)
  const offset = Number.parseInt(searchParams.get("offset") ?? "0", 10)

  // Date range params are inclusive day boundaries — `date_from` covers
  // items from 00:00:00, `date_to` covers items up to 23:59:59 of that
  // same day. Same convention as /api/drive.
  const dateFrom = dateFromStr ? new Date(`${dateFromStr}T00:00:00.000Z`) : undefined
  const dateTo = dateToStr ? new Date(`${dateToStr}T23:59:59.999Z`) : undefined

  // Optional `scope=system` returns the (currently empty) platform-wide
  // bucket for the System tab. Default is the caller's active org.
  const scope = searchParams.get("scope")
  const organizationId = scope === "system" ? null : activeOrgId

  const onlyNeedsUpload = searchParams.get("only_needs_upload") === "1"

  try {
    const result = await listSourceItems({
      status,
      view,
      organizationId,
      sourceId,
      q,
      dateFrom,
      dateTo,
      limit: Number.isFinite(limit) ? limit : 25,
      offset: Number.isFinite(offset) ? offset : 0,
      onlyNeedsUpload,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[sources/items] Error:", error)
    const message =
      error instanceof Error ? error.message : "Failed to list items"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
