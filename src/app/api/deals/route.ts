import { NextRequest, NextResponse } from "next/server"
import {
  listDeals,
  listDealClientOptions,
  listDealContactOptions,
  listDealFunnelStages,
  createDeal,
  updateDeal,
  setDealCancellation,
  getDeal,
} from "@/server/deals"

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
    const deals = await listDeals({ includeCancelled })
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
      cancelOnly,
      isCancelled,
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
    if (cancelOnly) {
      if (typeof isCancelled !== "boolean") {
        return NextResponse.json(
          { error: "isCancelled must be boolean" },
          { status: 400 },
        )
      }
      await setDealCancellation(id, isCancelled)
      return NextResponse.json({ success: true })
    }
    await updateDeal(id, {
      name,
      description,
      funnelStageId,
      clientId,
      contactIds,
      value,
      currency,
      isCancelled,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
