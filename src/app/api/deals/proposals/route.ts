// TODO(backend): здесь должна быть ручка — предложения агента по переводу сделок. Сейчас детерминированный мок, см. deals-mock.ts
import { NextRequest, NextResponse } from "next/server"
import { listDealFunnelStages, moveDealStage } from "@/server/deals"
import {
  requireMockOrg,
  loadBoardDeals,
  generateProposals,
  getResolvedProposals,
  markProposalResolved,
  appendFeedEvent,
} from "@/server/deals-mock"

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

async function currentProposals() {
  const { orgId } = await requireMockOrg()
  const [deals, stages] = await Promise.all([
    loadBoardDeals(),
    listDealFunnelStages(),
  ])
  return {
    orgId,
    proposals: generateProposals(deals, stages, getResolvedProposals(orgId)),
  }
}

export async function GET() {
  try {
    const { proposals } = await currentProposals()
    return NextResponse.json({ proposals })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, action, reason } = body
    if (action !== "accept" && action !== "reject") {
      return NextResponse.json(
        { error: "action must be accept or reject" },
        { status: 400 },
      )
    }
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const { orgId, userName } = await requireMockOrg()
    const [deals, stages] = await Promise.all([
      loadBoardDeals(),
      listDealFunnelStages(),
    ])
    const proposals = generateProposals(
      deals,
      stages,
      getResolvedProposals(orgId),
    )
    const p = proposals.find((x) => x.id === id)
    if (!p) {
      return NextResponse.json(
        { error: "Proposal not found" },
        { status: 404 },
      )
    }

    if (action === "accept") {
      await moveDealStage(
        p.dealId,
        p.toStageId,
        "Принято предложение агента" + (p.why ? ": " + p.why : ""),
      )
      markProposalResolved(orgId, id)
      appendFeedEvent(orgId, {
        actor: userName,
        isAI: false,
        text: "Принято предложение агента: {deal} → " + p.toLabel + ".",
        dealName: p.dealName,
      })
    } else {
      const r = typeof reason === "string" ? reason.trim() : ""
      markProposalResolved(orgId, id, r || undefined)
      appendFeedEvent(orgId, {
        actor: userName,
        isAI: false,
        text:
          "Отклонено предложение по {deal}" +
          (r ? ": «" + r + "»" : "") +
          ".",
        dealName: p.dealName,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
