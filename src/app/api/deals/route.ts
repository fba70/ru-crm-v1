import { NextRequest, NextResponse } from "next/server"
import {
  listDeals,
  listDealClientOptions,
  listDealContactOptions,
  listDealFunnelStages,
  createDeal,
  updateDeal,
  setDealStatus,
  moveDeal,
  getDeal,
} from "@/server/deals"
import { dealStatus, type DealStatus } from "@/db/schema"

export {
  type DealRow,
  type DealClientOption,
  type DealContactOption,
  type DealFunnelStageOption,
  type DealContactSummary,
} from "@/server/deals"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message === "Deal not found"
        ? 404
        : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    if (url.searchParams.get("clientOptions") === "1") {
      const options = await listDealClientOptions()
      return NextResponse.json({ options })
    }
    if (url.searchParams.get("contactOptions") === "1") {
      const clientId = url.searchParams.get("clientId")
      const options = await listDealContactOptions(clientId)
      return NextResponse.json({ options })
    }
    if (url.searchParams.get("funnelStages") === "1") {
      const stages = await listDealFunnelStages()
      return NextResponse.json({ stages })
    }
    const id = url.searchParams.get("id")
    if (id) {
      const dealRow = await getDeal(id)
      if (!dealRow) {
        return NextResponse.json({ error: "Deal not found" }, { status: 404 })
      }
      return NextResponse.json({ deal: dealRow })
    }
    const includeCancelled =
      url.searchParams.get("includeCancelled") === "1"
    const includeDeleted = url.searchParams.get("includeDeleted") === "1"
    const deals = await listDeals({ includeCancelled, includeDeleted })
    return NextResponse.json({ deals })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name,
      description,
      funnelStageId,
      clientId,
      contactIds,
      value,
      currency,
    } = body
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    if (!funnelStageId) {
      return NextResponse.json(
        { error: "funnelStageId is required" },
        { status: 400 },
      )
    }
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 },
      )
    }
    const result = await createDeal({
      name,
      description,
      funnelStageId,
      clientId,
      contactIds,
      value,
      currency,
    })
    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      id,
      statusOnly,
      status,
      moveOnly,
      position,
      name,
      description,
      funnelStageId,
      clientId,
      contactIds,
      value,
      currency,
    } = body
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    // `moveOnly` is the kanban drag shortcut: set the target column (funnel
    // stage) + the client-computed fractional-index `position`. Distinct from
    // the full update so a drag never touches name/value/contacts.
    if (moveOnly) {
      if (!funnelStageId) {
        return NextResponse.json(
          { error: "funnelStageId is required" },
          { status: 400 },
        )
      }
      if (typeof position !== "string" || position.length === 0) {
        return NextResponse.json(
          { error: "position is required" },
          { status: 400 },
        )
      }
      await moveDeal(id, { funnelStageId, position })
      return NextResponse.json({ success: true })
    }
    const isValidStatus = (s: unknown): s is DealStatus =>
      typeof s === "string" &&
      (dealStatus.enumValues as readonly string[]).includes(s)
    // `statusOnly` is the quick cancel / delete / restore shortcut (mirrors
    // tasks' `statusOnly`). Anything else goes through the full update.
    if (statusOnly) {
      if (!isValidStatus(status)) {
        return NextResponse.json(
          { error: "status must be one of: active, cancelled, deleted" },
          { status: 400 },
        )
      }
      await setDealStatus(id, status)
      return NextResponse.json({ success: true })
    }
    if (status !== undefined && !isValidStatus(status)) {
      return NextResponse.json(
        { error: "status must be one of: active, cancelled, deleted" },
        { status: 400 },
      )
    }
    await updateDeal(id, {
      name,
      description,
      funnelStageId,
      clientId,
      contactIds,
      value,
      currency,
      status,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
