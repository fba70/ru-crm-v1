import { NextRequest, NextResponse } from "next/server"
import {
  sendOrderToClient,
  resendOrderLink,
  reopenOrderToClient,
  returnOrderToDraft,
  cancelOrderAndRevoke,
} from "@/server/order-links"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message === "Order not found"
        ? 404
        : 400
  return NextResponse.json({ error: message }, { status })
}

// Maps a transition failure reason to an HTTP status + message.
function reasonResponse(reason: string) {
  const map: Record<string, { status: number; error: string }> = {
    email_required: {
      status: 422,
      error:
        "A recipient email is required to send this order to the client.",
    },
    invalid_email: { status: 422, error: "The recipient email is invalid." },
    conflict: {
      status: 409,
      error: "The order changed in the meantime — reload and try again.",
    },
  }
  const m = map[reason] ?? { status: 400, error: "Transition failed" }
  return NextResponse.json({ ok: false, reason, error: m.error }, { status: m.status })
}

// POST /api/orders/[id]/link  — order-status transitions that drive the guest
// link lifecycle. Body: { action, recipientEmail? }.
//   send    draft → awaiting_client (mint link)
//   resend  awaiting_client → rotate link
//   reopen  confirmed/finalized/cancelled → awaiting_client (fresh link)
//   pullback awaiting_client/cancelled → draft (revoke link)
//   cancel  → cancelled (revoke link)
// All org-scoping + status guards live in `@/server/order-links`.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    const body = await request.json().catch(() => ({}))
    const action = body?.action as string | undefined
    const recipientEmail =
      typeof body?.recipientEmail === "string" ? body.recipientEmail : undefined

    switch (action) {
      case "send": {
        const r = await sendOrderToClient(id, recipientEmail)
        return r.ok ? NextResponse.json(r) : reasonResponse(r.reason)
      }
      case "resend": {
        const r = await resendOrderLink(id, recipientEmail)
        return r.ok ? NextResponse.json(r) : reasonResponse(r.reason)
      }
      case "reopen": {
        const r = await reopenOrderToClient(id, recipientEmail)
        return r.ok ? NextResponse.json(r) : reasonResponse(r.reason)
      }
      case "pullback": {
        const r = await returnOrderToDraft(id)
        return r.ok ? NextResponse.json(r) : reasonResponse(r.reason)
      }
      case "cancel": {
        const r = await cancelOrderAndRevoke(id)
        return r.ok ? NextResponse.json(r) : reasonResponse(r.reason)
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    }
  } catch (error) {
    return errorResponse(error)
  }
}
