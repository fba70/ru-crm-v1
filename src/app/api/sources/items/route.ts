import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  listSourceItems,
  type SourceItemListStatus,
} from "@/server/source-items"

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const statusParam = searchParams.get("status")
  if (statusParam !== "pending" && statusParam !== "processed") {
    return NextResponse.json(
      { error: "status must be 'pending' or 'processed'" },
      { status: 400 },
    )
  }
  const status = statusParam as SourceItemListStatus

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
