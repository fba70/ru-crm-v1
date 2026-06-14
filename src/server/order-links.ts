import "server-only"

import { db } from "@/db/drizzle"
import {
  order,
  orderItem,
  orderAccessLink,
  product,
  client,
  type OrderStatus,
  type OrderLinkStatus,
  type EntityStatus,
} from "@/db/schema"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"
import {
  generateRawToken,
  hashToken,
  buildOrderLinkUrl,
} from "@/lib/order-link-token"
import { isValidEmail } from "@/lib/orders-format"

// Default link lifetime (spec §10 open question → 14-day global default;
// per-order windows can land later as a column + form field).
export const ORDER_LINK_EXPIRY_DAYS = 14

// ── Capabilities (derived, never stored — FR-4) ──────────────────────
export type OrderCapabilities = {
  editQuantity: boolean
  removeItem: boolean
  confirm: boolean
}

// Pure function of (grant.status, order.status). `addItem` is never a guest
// capability. Once status leaves `awaiting_client` the page is read-only.
export function capabilitiesFor(
  grantStatus: OrderLinkStatus,
  orderStatus: OrderStatus,
): OrderCapabilities {
  const live = grantStatus === "active" && orderStatus === "awaiting_client"
  return { editQuantity: live, removeItem: live, confirm: live }
}

// ── Internal helpers ─────────────────────────────────────────────────

async function requireOrgAndOrder(orderId: string) {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw new Error("No active organization")
  const rows = await db
    .select({ order, clientEmail: client.email })
    .from(order)
    .leftJoin(client, eq(order.clientId, client.id))
    .where(eq(order.id, orderId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error("Order not found")
  if (row.order.organizationId !== orgId) throw new Error("Unauthorized")
  return { orgId, order: row.order, clientEmail: row.clientEmail }
}

async function revokeActiveGrants(orderId: string) {
  await db
    .update(orderAccessLink)
    .set({ status: "revoked" })
    .where(
      and(
        eq(orderAccessLink.orderId, orderId),
        eq(orderAccessLink.status, "active"),
      ),
    )
}

// Mint a fresh active grant (FR-1). Revokes any leftover active grant first
// so invariant #1 (one active grant per order) always holds. Returns the raw
// token ONCE — never persisted.
async function mintGrant(orderId: string, recipientEmail: string | null) {
  await revokeActiveGrants(orderId)
  const raw = generateRawToken()
  const now = new Date()
  const expiresAt = new Date(
    now.getTime() + ORDER_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  )
  await db.insert(orderAccessLink).values({
    id: randomUUID(),
    orderId,
    tokenHash: hashToken(raw),
    recipientEmail,
    status: "active",
    expiresAt,
    createdAt: now,
  })
  return { raw, expiresAt }
}

// Set the order total to the sum of its line position prices, in one
// statement. Called after any line-item mutation.
async function recomputeOrderTotal(orderId: string) {
  await db
    .update(order)
    .set({
      totalAmount: sql`(select coalesce(sum(position_price), 0) from order_item where order_id = ${orderId})`,
    })
    .where(eq(order.id, orderId))
}

async function bumpLastAccessed(token: string) {
  await db
    .update(orderAccessLink)
    .set({ lastAccessedAt: new Date() })
    .where(eq(orderAccessLink.tokenHash, hashToken(token)))
}

// ── Internal transitions (org-scoped; the ONLY places that mint/revoke) ──

export type LinkInfo = {
  url: string
  expiresAt: string
  recipientEmail: string | null
}

export type HandToClientResult =
  | { ok: true; status: "awaiting_client"; link: LinkInfo }
  | { ok: false; reason: "invalid_email" | "conflict" }

// Transition `order.status → awaiting_client` from one of `fromStatuses` and
// mint a fresh link (FR-1 / FR-7 / FR-9). Optimistic guard: zero rows updated
// ⇒ conflict (status raced / not in an allowed source state).
async function handToClient(
  orderId: string,
  recipientEmail: string | undefined,
  fromStatuses: OrderStatus[],
): Promise<HandToClientResult> {
  const { orgId, clientEmail } = await requireOrgAndOrder(orderId)
  // Email is OPTIONAL: the link is delivered by copy/paste (no mail is sent),
  // so a blank address is allowed and mints an anonymous link. Only a
  // NON-EMPTY but malformed address is rejected to avoid storing garbage.
  const email = (recipientEmail?.trim() || clientEmail || "").trim()
  if (email && !isValidEmail(email)) return { ok: false, reason: "invalid_email" }

  const updated = await db
    .update(order)
    .set({ status: "awaiting_client" })
    .where(
      and(
        eq(order.id, orderId),
        eq(order.organizationId, orgId),
        inArray(order.status, fromStatuses),
      ),
    )
    .returning({ id: order.id })
  if (updated.length === 0) return { ok: false, reason: "conflict" }

  const { raw, expiresAt } = await mintGrant(orderId, email || null)
  return {
    ok: true,
    status: "awaiting_client",
    link: {
      url: buildOrderLinkUrl(raw),
      expiresAt: expiresAt.toISOString(),
      recipientEmail: email || null,
    },
  }
}

/** draft → awaiting_client + mint (FR-1). */
export function sendOrderToClient(orderId: string, recipientEmail?: string) {
  return handToClient(orderId, recipientEmail, ["draft"])
}

/** awaiting_client → awaiting_client, rotating the link (FR-7 resend). */
export function resendOrderLink(orderId: string, recipientEmail?: string) {
  return handToClient(orderId, recipientEmail, ["awaiting_client"])
}

/** confirmed/finalized/cancelled → awaiting_client + fresh link (FR-9). */
export function reopenOrderToClient(orderId: string, recipientEmail?: string) {
  return handToClient(orderId, recipientEmail, [
    "confirmed",
    "finalized",
    "cancelled",
  ])
}

export type SimpleTransitionResult =
  | { ok: true; status: OrderStatus }
  | { ok: false; reason: "conflict" }

// awaiting_client/cancelled → draft + revoke the live link (FR-9/FR-10
// pull-back). Hands ownership back to INTERNAL and unlocks editing.
export async function returnOrderToDraft(
  orderId: string,
): Promise<SimpleTransitionResult> {
  const { orgId } = await requireOrgAndOrder(orderId)
  const updated = await db
    .update(order)
    .set({ status: "draft" })
    .where(
      and(
        eq(order.id, orderId),
        eq(order.organizationId, orgId),
        inArray(order.status, ["awaiting_client", "cancelled"]),
      ),
    )
    .returning({ id: order.id })
  if (updated.length === 0) return { ok: false, reason: "conflict" }
  await revokeActiveGrants(orderId)
  return { ok: true, status: "draft" }
}

// → cancelled from any non-terminal status + revoke the live link (spec §10:
// cancelling cascades to revoke the grant).
export async function cancelOrderAndRevoke(
  orderId: string,
): Promise<SimpleTransitionResult> {
  const { orgId } = await requireOrgAndOrder(orderId)
  const updated = await db
    .update(order)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(order.id, orderId),
        eq(order.organizationId, orgId),
        inArray(order.status, [
          "draft",
          "awaiting_client",
          "confirmed",
          "finalized",
        ]),
      ),
    )
    .returning({ id: order.id })
  if (updated.length === 0) return { ok: false, reason: "conflict" }
  await revokeActiveGrants(orderId)
  return { ok: true, status: "cancelled" }
}

// confirmed → finalized. Internal-only (no grant change — a confirmed order
// has no active link). Terminal: hand-off to accounting is a later step.
export async function finalizeOrder(
  orderId: string,
): Promise<SimpleTransitionResult> {
  const { orgId } = await requireOrgAndOrder(orderId)
  const updated = await db
    .update(order)
    .set({ status: "finalized" })
    .where(
      and(
        eq(order.id, orderId),
        eq(order.organizationId, orgId),
        eq(order.status, "confirmed"),
      ),
    )
    .returning({ id: order.id })
  if (updated.length === 0) return { ok: false, reason: "conflict" }
  return { ok: true, status: "finalized" }
}

// Link metadata for the internal order view (no raw token — that's gone).
export type OrderLinkMeta = {
  status: OrderLinkStatus
  expiresAt: string
  lastAccessedAt: string | null
  recipientEmail: string | null
  confirmedAt: string | null
}

// The most relevant grant for an order: the active one if present, else the
// most recent. Caller is responsible for org-scoping the order.
export async function getOrderLinkMeta(
  orderId: string,
): Promise<OrderLinkMeta | null> {
  const rows = await db
    .select()
    .from(orderAccessLink)
    .where(eq(orderAccessLink.orderId, orderId))
    .orderBy(
      sql`case when ${orderAccessLink.status} = 'active' then 0 else 1 end`,
      sql`${orderAccessLink.createdAt} desc`,
    )
    .limit(1)
  const g = rows[0]
  if (!g) return null
  return {
    status: g.status,
    expiresAt: g.expiresAt.toISOString(),
    lastAccessedAt: g.lastAccessedAt?.toISOString() ?? null,
    recipientEmail: g.recipientEmail,
    confirmedAt: g.confirmedAt?.toISOString() ?? null,
  }
}

// ── Public guest resolver (FR-3) ─────────────────────────────────────

export type GuestLineItem = {
  id: string
  productId: string | null
  productName: string | null
  imageUrl: string | null
  // Product catalog detail surfaced on the client review form. Pulled from the
  // real `web_page_url` column + `additional_metadata` jsonb keys.
  webPageUrl: string | null
  color: string | null
  sugar: string | null
  alcohol: string | null // already suffixed with "%" when present
  bottleVolume: string | null
  countryRegion: string | null // "country, region" (either side optional)
  quantity: number
  unitPrice: number
  positionPrice: number
}

export type GuestOrderView = {
  orderId: string
  orderDate: string
  description: string | null
  status: OrderStatus
  currency: string
  totalAmount: number
  items: GuestLineItem[]
  grantStatus: OrderLinkStatus
  recipientEmail: string | null
  expiresAt: string
  confirmedAt: string | null
  can: OrderCapabilities
}

export type ResolveFailReason = "not_found" | "revoked" | "expired"

export type ResolveResult =
  | { ok: true; view: GuestOrderView }
  | { ok: false; reason: ResolveFailReason }

// Single chokepoint for every guest read/write. Looks the grant up by token
// hash, lazily expires it, then loads the order BY grant.order_id (never a
// client-supplied id). `used` grants resolve fine (read-only confirmed view);
// only not_found / revoked / expired are rejected.
export async function resolveOrderLink(
  token: string,
): Promise<ResolveResult> {
  if (!token) return { ok: false, reason: "not_found" }
  const tokenHash = hashToken(token)
  const grants = await db
    .select()
    .from(orderAccessLink)
    .where(eq(orderAccessLink.tokenHash, tokenHash))
    .limit(1)
  const grant = grants[0]
  if (!grant) return { ok: false, reason: "not_found" }
  if (grant.status === "revoked") return { ok: false, reason: "revoked" }

  let gs: OrderLinkStatus = grant.status
  if (gs === "active" && grant.expiresAt.getTime() < Date.now()) {
    await db
      .update(orderAccessLink)
      .set({ status: "expired" })
      .where(eq(orderAccessLink.id, grant.id))
    gs = "expired"
  }
  if (gs === "expired") return { ok: false, reason: "expired" }

  const orders = await db
    .select()
    .from(order)
    .where(eq(order.id, grant.orderId))
    .limit(1)
  const o = orders[0]
  if (!o) return { ok: false, reason: "not_found" }

  const items = await db
    .select({
      id: orderItem.id,
      productId: orderItem.productId,
      productName: product.name,
      imageUrl: product.imageUrl,
      webPageUrl: product.webPageUrl,
      color: sql<string | null>`${product.additionalMetadata} ->> 'color'`,
      sugar: sql<string | null>`${product.additionalMetadata} ->> 'sugar'`,
      alcohol: sql<string | null>`${product.additionalMetadata} ->> 'alcohol'`,
      bottleVolume: sql<string | null>`${product.additionalMetadata} ->> 'bottle_volume'`,
      countryName: sql<string | null>`${product.additionalMetadata} ->> 'country_name'`,
      region: sql<string | null>`${product.additionalMetadata} ->> 'region'`,
      quantity: orderItem.quantity,
      unitPrice: orderItem.unitPrice,
      positionPrice: orderItem.positionPrice,
    })
    .from(orderItem)
    .leftJoin(product, eq(orderItem.productId, product.id))
    .where(eq(orderItem.orderId, o.id))
    .orderBy(asc(orderItem.createdAt))

  return {
    ok: true,
    view: {
      orderId: o.id,
      orderDate: o.orderDate.toISOString(),
      description: o.description,
      status: o.status,
      currency: o.currency,
      totalAmount: Number(o.totalAmount),
      items: items.map((i) => {
        const alcohol = i.alcohol?.trim()
        return {
          id: i.id,
          productId: i.productId,
          productName: i.productName,
          imageUrl: i.imageUrl,
          webPageUrl: i.webPageUrl,
          color: i.color?.trim() || null,
          sugar: i.sugar?.trim() || null,
          alcohol: alcohol
            ? alcohol.includes("%")
              ? alcohol
              : `${alcohol}%`
            : null,
          bottleVolume: i.bottleVolume?.trim() || null,
          countryRegion:
            [i.countryName?.trim(), i.region?.trim()]
              .filter(Boolean)
              .join(", ") || null,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          positionPrice: Number(i.positionPrice),
        }
      }),
      grantStatus: gs,
      recipientEmail: grant.recipientEmail,
      expiresAt: grant.expiresAt.toISOString(),
      confirmedAt: grant.confirmedAt?.toISOString() ?? null,
      can: capabilitiesFor(gs, o.status),
    },
  }
}

// Guest-facing product card detail. Same shape as the operator catalog's
// `ProductDetail` but **without any stock fields** (no `totalStock`, no
// per-warehouse `stockMetadata`) — the client must not see our inventory.
// Authorization is the order token: the product must be a line on the order
// the token grants, so a guest can only inspect products already in front of
// them.
export type GuestProductDetail = {
  id: string
  name: string
  category: string | null
  webPageUrl: string | null
  price: number | null
  imageUrl: string | null
  accountingMetadata: Record<string, unknown>
  additionalMetadata: Record<string, unknown>
  status: EntityStatus
}

export async function getGuestProductDetail(
  token: string,
  productId: string,
): Promise<GuestProductDetail | null> {
  const r = await resolveOrderLink(token)
  if (!r.ok) return null
  // Token-scoped authorization: only products that are line items on this
  // order may be inspected (never an arbitrary catalog id).
  if (!r.view.items.some((i) => i.productId === productId)) return null

  const rows = await db
    .select({
      id: product.id,
      name: product.name,
      category: product.category,
      webPageUrl: product.webPageUrl,
      price: product.price,
      imageUrl: product.imageUrl,
      accountingMetadata: product.accountingMetadata,
      additionalMetadata: product.additionalMetadata,
      status: product.status,
    })
    .from(product)
    .where(eq(product.id, productId))
    .limit(1)
  const p = rows[0]
  if (!p) return null

  return {
    id: p.id,
    name: p.name,
    category: p.category,
    webPageUrl: p.webPageUrl,
    price: p.price === null ? null : Number(p.price),
    imageUrl: p.imageUrl,
    accountingMetadata:
      (p.accountingMetadata as Record<string, unknown> | null) ?? {},
    additionalMetadata:
      (p.additionalMetadata as Record<string, unknown> | null) ?? {},
    status: p.status,
  }
}

// ── Guest mutations (FR-5 / FR-6) ────────────────────────────────────
// Each re-resolves the token and re-checks the capability on EVERY call.
// Writes are pinned to the token-derived order_id alongside the line id
// (IDOR guard — invariant #4).

export type GuestMutationResult =
  | { ok: true }
  | { ok: false; reason: ResolveFailReason | "forbidden" | "not_found" | "conflict" }

export async function guestSetQuantity(
  token: string,
  lineItemId: string,
  qty: number,
): Promise<GuestMutationResult> {
  const r = await resolveOrderLink(token)
  if (!r.ok) return r
  if (!r.view.can.editQuantity) return { ok: false, reason: "forbidden" }

  const quantity = Math.max(1, Math.trunc(Number(qty)) || 1)
  const updated = await db
    .update(orderItem)
    .set({
      quantity,
      positionPrice: sql`${orderItem.unitPrice} * ${quantity}`,
    })
    .where(
      and(
        eq(orderItem.id, lineItemId),
        eq(orderItem.orderId, r.view.orderId),
      ),
    )
    .returning({ id: orderItem.id })
  if (updated.length === 0) return { ok: false, reason: "not_found" }

  await recomputeOrderTotal(r.view.orderId)
  await bumpLastAccessed(token)
  return { ok: true }
}

export async function guestRemoveItem(
  token: string,
  lineItemId: string,
): Promise<GuestMutationResult> {
  const r = await resolveOrderLink(token)
  if (!r.ok) return r
  if (!r.view.can.removeItem) return { ok: false, reason: "forbidden" }

  await db
    .delete(orderItem)
    .where(
      and(
        eq(orderItem.id, lineItemId),
        eq(orderItem.orderId, r.view.orderId),
      ),
    )
  await recomputeOrderTotal(r.view.orderId)
  await bumpLastAccessed(token)
  return { ok: true }
}

export async function guestConfirmOrder(
  token: string,
): Promise<GuestMutationResult> {
  const r = await resolveOrderLink(token)
  if (!r.ok) return r
  if (!r.view.can.confirm) return { ok: false, reason: "forbidden" }

  // Optimistic guard is the source of truth (Neon HTTP has no multi-statement
  // transactions): zero rows ⇒ already moved / raced ⇒ conflict (FR-6).
  const updated = await db
    .update(order)
    .set({ status: "confirmed" })
    .where(and(eq(order.id, r.view.orderId), eq(order.status, "awaiting_client")))
    .returning({ id: order.id })
  if (updated.length === 0) return { ok: false, reason: "conflict" }

  // Grant bookkeeping. Even if this lagged, `can.confirm` is false once the
  // order is `confirmed`, so a stale active grant can't double-confirm.
  await db
    .update(orderAccessLink)
    .set({ status: "used", confirmedAt: new Date() })
    .where(eq(orderAccessLink.tokenHash, hashToken(token)))
  return { ok: true }
}
