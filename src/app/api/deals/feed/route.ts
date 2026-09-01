// Лента решений — реальный журнал (deal_activity), одна строка на КАЖДЫЙ
// перевод/создание сделки, пишется в src/server/deals.ts (moveDealStage,
// createDeal). Больше не мок/деривация из deal.changes.

import { NextResponse } from "next/server"
import { listRecentDealActivity } from "@/server/deals"
import { getServerSession } from "@/lib/get-session"

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
    const session = await getServerSession()
    if (!session) throw new Error("Unauthorized")
    const orgId = session.session.activeOrganizationId
    if (!orgId) throw new Error("No active organization")
    const events = await listRecentDealActivity(orgId)
    return NextResponse.json({ events })
  } catch (error) {
    return errorResponse(error)
  }
}
