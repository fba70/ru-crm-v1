import { NextRequest, NextResponse } from "next/server"
import {
  createAndParseOrderRequest,
  getOrderRequest,
  linkOrderToRequest,
  updateOrderRequestItemStatus,
  setOrderRequestStatus,
} from "@/server/order-requests"
import { orderRequestItemStatus, type OrderRequestItemStatus } from "@/db/schema"

export {
  type OrderRequestItemView,
  type OrderRequestDetail,
} from "@/server/order-requests"

// The LLM split runs inside POST — give it room beyond the default.
export const maxDuration = 120

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

const isItemStatus = (v: unknown): v is OrderRequestItemStatus =>
  typeof v === "string" &&
  (orderRequestItemStatus.enumValues as readonly string[]).includes(v)

// GET /api/order-requests?id=…  → { request }  (404 if missing)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    const found = await getOrderRequest(id)
    if (!found) {
      return NextResponse.json(
        { error: "Order request not found" },
        { status: 404 },
      )
    }
    return NextResponse.json({ request: found })
  } catch (error) {
    return errorResponse(error)
  }
}

// POST /api/order-requests — create + parse one pasted client request.
// Body: { clientId, rawText, comment? }. Always returns the request id; the
// LLM split is best-effort (a parse failure still yields a usable request the
// rep can assemble manually).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { clientId, rawText, comment } = body
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 },
      )
    }
    if (!rawText || !String(rawText).trim()) {
      return NextResponse.json(
        { error: "rawText is required" },
        { status: 400 },
      )
    }
    const result = await createAndParseOrderRequest({ clientId, rawText, comment })
    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    return errorResponse(error)
  }
}

// PUT /api/order-requests — wizard-progress mutations, switched on `action`:
//   { id, action: "linkOrder",  orderId }          → attach the draft order
//   { id, action: "itemStatus", itemId, status }   → mark a step added/skipped
//   { id, action: "status",     status }           → done / abandoned / assembling
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, action } = body
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    if (action === "linkOrder") {
      if (!body.orderId) {
        return NextResponse.json(
          { error: "orderId is required" },
          { status: 400 },
        )
      }
      await linkOrderToRequest(id, body.orderId)
      return NextResponse.json({ success: true })
    }

    if (action === "itemStatus") {
      if (!body.itemId || !isItemStatus(body.status)) {
        return NextResponse.json(
          { error: "itemId and a valid status are required" },
          { status: 400 },
        )
      }
      await updateOrderRequestItemStatus(id, body.itemId, body.status)
      return NextResponse.json({ success: true })
    }

    if (action === "status") {
      if (
        body.status !== "done" &&
        body.status !== "abandoned" &&
        body.status !== "assembling"
      ) {
        return NextResponse.json(
          { error: "status must be done | abandoned | assembling" },
          { status: 400 },
        )
      }
      await setOrderRequestStatus(id, body.status)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    return errorResponse(error)
  }
}
