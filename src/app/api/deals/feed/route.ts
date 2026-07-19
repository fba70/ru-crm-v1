// TODO(backend): здесь должна быть ручка — журнал решений (audit log) по орге. Сейчас сид из реальных deal.changes + мок-события агента + in-memory аппенды, см. deals-mock.ts

import { NextResponse } from "next/server"
import { buildFeed, loadBoardDeals, requireMockOrg } from "@/server/deals-mock"

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
    const { orgId } = await requireMockOrg()
    const deals = await loadBoardDeals()
    return NextResponse.json({ events: buildFeed(orgId, deals) })
  } catch (error) {
    return errorResponse(error)
  }
}
