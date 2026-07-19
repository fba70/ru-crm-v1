// TODO(backend): здесь должна быть ручка — интел по сделкам (остывание/нормы/бейджи/провенанс-источник/confidence/локи) + коммитменты стадий. Сейчас мок, см. deals-mock.ts
import { NextResponse } from "next/server"
import {
  requireMockOrg,
  loadBoardDeals,
  buildIntel,
} from "@/server/deals-mock"
import { listDealFunnelStages } from "@/server/deals"

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

export async function GET() {
  try {
    await requireMockOrg()
    const [deals, stages] = await Promise.all([
      loadBoardDeals(),
      listDealFunnelStages(),
    ])
    const data = buildIntel(deals, stages)
    return NextResponse.json(data)
  } catch (error) {
    return errorResponse(error)
  }
}
