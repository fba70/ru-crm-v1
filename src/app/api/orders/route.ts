import { NextRequest, NextResponse } from "next/server"
import {
  listOrders,
  getOrder,
  createOrder,
  updateOrder,
  setOrderStatus,
  listOrderClientOptions,
} from "@/server/orders"
import { orderStatus, type OrderStatus } from "@/db/schema"

export {
  type OrderRow,
  type OrderItemRow,
  type OrderDetail,
  type OrderClientOption,
  type ListOrdersResult,
} from "@/server/orders"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

const isOrderStatus = (v: unknown): v is OrderStatus =>
  typeof v === "string" &&
  (orderStatus.enumValues as readonly string[]).includes(v)

// GET /api/orders?q=&status=&limit=&offset=  → { rows, total }
// GET /api/orders?id=…                       → { order }
// GET /api/orders?clientOptions=1            → { clients }
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    if (searchParams.get("clientOptions") === "1") {
      const clients = await listOrderClientOptions()
      return NextResponse.json({ clients })
    }

    const id = searchParams.get("id")
    if (id) {
      const found = await getOrder(id)
      if (!found) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 })
      }
      return NextResponse.json({ order: found })
    }

    const statusRaw = searchParams.get("status")
    const status = isOrderStatus(statusRaw) ? statusRaw : undefined

    const limitRaw = Number.parseInt(searchParams.get("limit") ?? "25", 10)
    const offsetRaw = Number.parseInt(searchParams.get("offset") ?? "0", 10)
    const q = searchParams.get("q") ?? undefined

    const result = await listOrders({
      q: q && q.trim().length > 0 ? q : undefined,
      status,
      limit: Number.isFinite(limitRaw) ? limitRaw : 25,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

// POST /api/orders  — create. Required: clientId. Optional: description,
// orderDate, status, currency, items[].
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { clientId, description, orderDate, status, currency, items } = body
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 },
      )
    }
    const result = await createOrder({
      clientId,
      description,
      orderDate,
      status: isOrderStatus(status) ? status : undefined,
      currency,
      items,
    })
    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    return errorResponse(error)
  }
}

// PUT /api/orders  — update. `statusOnly: true` + `status` is the quick
// status-transition shortcut; otherwise a partial update of the order.
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, statusOnly, status } = body
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    if (statusOnly) {
      if (!isOrderStatus(status)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 },
        )
      }
      await setOrderStatus(id, status)
      return NextResponse.json({ success: true })
    }

    const { clientId, description, orderDate, currency, items } = body
    await updateOrder(id, {
      clientId,
      description,
      orderDate,
      status: status !== undefined && isOrderStatus(status) ? status : undefined,
      currency,
      items,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
