"use server"

import { db } from "@/db/drizzle"
import {
  order,
  orderItem,
  client,
  product,
  user,
  type OrderStatus,
} from "@/db/schema"
import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"

// Lightweight shape for the orders table — only the columns the table
// renders (date / client / total / status), plus ids for row actions.
export type OrderRow = {
  id: string
  orderDate: string
  clientId: string
  clientName: string | null
  // numeric(14,2) comes back from drizzle as a string; the API/UI use number.
  totalAmount: number
  currency: string
  status: OrderStatus
  createdAt: string
}

// One product line on an order, with the product name joined for display.
export type OrderItemRow = {
  id: string
  productId: string
  productName: string | null
  quantity: number
  unitPrice: number
  positionPrice: number
}

// Full order shape for a detail view — header fields + the line items.
export type OrderDetail = {
  id: string
  orderDate: string
  description: string | null
  status: OrderStatus
  totalAmount: number
  currency: string
  clientId: string
  clientName: string | null
  userId: string
  userName: string | null
  organizationId: string
  createdAt: string
  updatedAt: string
  items: OrderItemRow[]
}

export type OrderClientOption = {
  id: string
  name: string
}

// One product line as supplied by a caller (create / update). `unitPrice`
// falls back to the product's current catalog price when omitted.
export type OrderItemInput = {
  productId: string
  quantity: number
  unitPrice?: number | null
}

export type ListOrdersParams = {
  q?: string
  status?: OrderStatus
  limit?: number
  offset?: number
}

export type ListOrdersResult = {
  rows: OrderRow[]
  total: number
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertOrderInOrg(orderId: string, organizationId: string) {
  const rows = await db
    .select()
    .from(order)
    .where(eq(order.id, orderId))
    .limit(1)
  const current = rows[0]
  if (!current) throw new Error("Order not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

// The client an order is assigned to must belong to the active org. Soft-
// deleted clients are rejected; `active` / `initial` / `suspended` are all
// allowed (operators may order for an auto-discovered or paused client).
async function assertClientInOrg(clientId: string, organizationId: string) {
  const rows = await db
    .select({ id: client.id, organizationId: client.organizationId, status: client.status })
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const current = rows[0]
  if (!current) throw new Error("Client not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  if (current.status === "deleted") throw new Error("Client is deleted")
  return current
}

// Fixed-format numeric string for the `numeric` columns (drizzle accepts a
// string or number; a fixed 2-decimal string keeps the column consistent).
function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2)
}

function normalizeCurrency(raw: string | null | undefined): string {
  const c = (raw ?? "").trim().toUpperCase()
  if (!c) return "RUB"
  if (!/^[A-Z]{3}$/.test(c)) throw new Error("Currency must be a 3-letter ISO code")
  return c
}

// Resolve the supplied line items against the catalog (org-scoped), filling
// `unitPrice` from the product price when omitted and computing each
// `positionPrice` + the order total. Throws if any product is missing or out
// of the org's scope.
async function resolveItems(
  organizationId: string,
  items: OrderItemInput[],
): Promise<{
  rows: { productId: string; quantity: number; unitPrice: number; positionPrice: number }[]
  total: number
}> {
  if (!items.length) return { rows: [], total: 0 }

  const ids = [...new Set(items.map((i) => i.productId))]
  const found = await db
    .select({ id: product.id, price: product.price })
    .from(product)
    .where(
      and(eq(product.organizationId, organizationId), inArray(product.id, ids)),
    )
  const priceById = new Map(found.map((p) => [p.id, p.price]))

  let total = 0
  const rows = items.map((i) => {
    if (!priceById.has(i.productId)) {
      throw new Error(`Product not found in catalog: ${i.productId}`)
    }
    const quantity = Math.max(1, Math.trunc(Number(i.quantity) || 1))
    const catalogPrice = priceById.get(i.productId)
    const unitPrice =
      i.unitPrice != null && Number.isFinite(i.unitPrice)
        ? Number(i.unitPrice)
        : catalogPrice === null
          ? 0
          : Number(catalogPrice)
    const positionPrice = unitPrice * quantity
    total += positionPrice
    return { productId: i.productId, quantity, unitPrice, positionPrice }
  })

  return { rows, total }
}

// Server-side paginated + searched orders listing. Search is a single ILIKE
// term OR'd across the order description and the assigned client's name —
// kept intentionally simple; richer filters come later.
export async function listOrders(
  params: ListOrdersParams = {},
): Promise<ListOrdersResult> {
  const { activeOrgId } = await requireOrgContext()

  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100)
  const offset = Math.max(params.offset ?? 0, 0)
  const q = params.q?.trim()

  const where = and(
    eq(order.organizationId, activeOrgId),
    params.status ? eq(order.status, params.status) : undefined,
    q && q.length > 0
      ? or(
          ilike(order.description, `%${q}%`),
          ilike(client.name, `%${q}%`),
        )
      : undefined,
  )

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: order.id,
        orderDate: order.orderDate,
        clientId: order.clientId,
        clientName: client.name,
        totalAmount: order.totalAmount,
        currency: order.currency,
        status: order.status,
        createdAt: order.createdAt,
      })
      .from(order)
      .leftJoin(client, eq(order.clientId, client.id))
      .where(where)
      .orderBy(desc(order.orderDate))
      .limit(limit)
      .offset(offset),
    db
      .select({ n: count() })
      .from(order)
      .leftJoin(client, eq(order.clientId, client.id))
      .where(where),
  ])

  return {
    rows: rows.map((r) => ({
      id: r.id,
      orderDate: r.orderDate.toISOString(),
      clientId: r.clientId,
      clientName: r.clientName,
      totalAmount: Number(r.totalAmount),
      currency: r.currency,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    total: totalRows[0]?.n ?? 0,
  }
}

// Full single-order fetch (header + line items), org-scoped. Returns null
// when the id doesn't exist or belongs to another org (route → 404).
export async function getOrder(id: string): Promise<OrderDetail | null> {
  const { activeOrgId } = await requireOrgContext()

  const headerRows = await db
    .select({
      order,
      clientName: client.name,
      userName: user.name,
    })
    .from(order)
    .leftJoin(client, eq(order.clientId, client.id))
    .leftJoin(user, eq(order.userId, user.id))
    .where(and(eq(order.id, id), eq(order.organizationId, activeOrgId)))
    .limit(1)

  const h = headerRows[0]
  if (!h) return null

  const itemRows = await db
    .select({
      id: orderItem.id,
      productId: orderItem.productId,
      productName: product.name,
      quantity: orderItem.quantity,
      unitPrice: orderItem.unitPrice,
      positionPrice: orderItem.positionPrice,
    })
    .from(orderItem)
    .leftJoin(product, eq(orderItem.productId, product.id))
    .where(eq(orderItem.orderId, id))
    .orderBy(asc(orderItem.createdAt))

  return {
    id: h.order.id,
    orderDate: h.order.orderDate.toISOString(),
    description: h.order.description,
    status: h.order.status,
    totalAmount: Number(h.order.totalAmount),
    currency: h.order.currency,
    clientId: h.order.clientId,
    clientName: h.clientName,
    userId: h.order.userId,
    userName: h.userName,
    organizationId: h.order.organizationId,
    createdAt: h.order.createdAt.toISOString(),
    updatedAt: h.order.updatedAt.toISOString(),
    items: itemRows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      quantity: r.quantity,
      unitPrice: Number(r.unitPrice),
      positionPrice: Number(r.positionPrice),
    })),
  }
}

export async function createOrder(data: {
  clientId: string
  description?: string | null
  orderDate?: string | Date | null
  status?: OrderStatus
  currency?: string | null
  items?: OrderItemInput[]
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.clientId) throw new Error("Client is required")
  await assertClientInOrg(data.clientId, activeOrgId)

  const { rows: itemRows, total } = await resolveItems(
    activeOrgId,
    data.items ?? [],
  )

  const id = randomUUID()
  const now = new Date()
  const orderDate = data.orderDate ? new Date(data.orderDate) : now

  await db.insert(order).values({
    id,
    orderDate,
    description: data.description?.trim() || null,
    status: data.status ?? "draft",
    totalAmount: money(total),
    currency: normalizeCurrency(data.currency),
    clientId: data.clientId,
    userId: session.user.id,
    organizationId: activeOrgId,
    createdAt: now,
    updatedAt: now,
  })

  if (itemRows.length > 0) {
    await db.insert(orderItem).values(
      itemRows.map((r) => ({
        id: randomUUID(),
        orderId: id,
        productId: r.productId,
        quantity: r.quantity,
        unitPrice: money(r.unitPrice),
        positionPrice: money(r.positionPrice),
        createdAt: now,
        updatedAt: now,
      })),
    )
  }

  return { id }
}

export async function updateOrder(
  orderId: string,
  data: {
    clientId?: string
    description?: string | null
    orderDate?: string | Date | null
    status?: OrderStatus
    currency?: string | null
    // When provided, replaces the whole line-item set (delete + re-insert)
    // and recomputes the total. Cardinality is small; diffing is overkill.
    items?: OrderItemInput[]
  },
) {
  const { activeOrgId } = await requireOrgContext()
  await assertOrderInOrg(orderId, activeOrgId)

  if (data.clientId !== undefined) {
    await assertClientInOrg(data.clientId, activeOrgId)
  }

  const now = new Date()
  let totalOverride: number | undefined

  if (data.items !== undefined) {
    const { rows: itemRows, total } = await resolveItems(activeOrgId, data.items)
    await db.delete(orderItem).where(eq(orderItem.orderId, orderId))
    if (itemRows.length > 0) {
      await db.insert(orderItem).values(
        itemRows.map((r) => ({
          id: randomUUID(),
          orderId,
          productId: r.productId,
          quantity: r.quantity,
          unitPrice: money(r.unitPrice),
          positionPrice: money(r.positionPrice),
          createdAt: now,
          updatedAt: now,
        })),
      )
    }
    totalOverride = total
  }

  await db
    .update(order)
    .set({
      ...(data.clientId !== undefined ? { clientId: data.clientId } : {}),
      ...(data.description !== undefined
        ? { description: data.description?.trim() || null }
        : {}),
      ...(data.orderDate !== undefined && data.orderDate !== null
        ? { orderDate: new Date(data.orderDate) }
        : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.currency !== undefined
        ? { currency: normalizeCurrency(data.currency) }
        : {}),
      ...(totalOverride !== undefined
        ? { totalAmount: money(totalOverride) }
        : {}),
    })
    .where(eq(order.id, orderId))
}

// Quick status-only transition (mirrors deals' `setDealStatus`).
export async function setOrderStatus(orderId: string, status: OrderStatus) {
  const { activeOrgId } = await requireOrgContext()
  await assertOrderInOrg(orderId, activeOrgId)
  await db.update(order).set({ status }).where(eq(order.id, orderId))
}

// Clients selectable when creating an order — active + initial, soft-deleted
// excluded. Mirrors `listDealClientOptions`.
export async function listOrderClientOptions(): Promise<OrderClientOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        inArray(client.status, ["active", "initial"]),
      ),
    )
    .orderBy(asc(client.name))
  return rows
}
