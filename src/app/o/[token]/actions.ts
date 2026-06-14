"use server"

import { revalidatePath } from "next/cache"
import {
  guestSetQuantity,
  guestRemoveItem,
  guestConfirmOrder,
  getGuestProductDetail,
} from "@/server/order-links"

// Thin server-action wrappers around the guest mutations. Each one re-resolves
// + re-authorizes the token inside the server function on every call (FR-5);
// the token is never trusted from a hidden field for authorization. We only
// revalidate the one guest path so the RSC re-reads fresh state.

export async function setQuantityAction(
  token: string,
  lineItemId: string,
  qty: number,
) {
  const r = await guestSetQuantity(token, lineItemId, qty)
  revalidatePath(`/o/${token}`)
  return r
}

export async function removeItemAction(token: string, lineItemId: string) {
  const r = await guestRemoveItem(token, lineItemId)
  revalidatePath(`/o/${token}`)
  return r
}

export async function confirmOrderAction(token: string) {
  const r = await guestConfirmOrder(token)
  revalidatePath(`/o/${token}`)
  return r
}

// Read-only product-card lookup for the guest review form. Authorization is
// the token: the product must be a line on the order it grants. Returns the
// catalog detail minus any stock fields (see `getGuestProductDetail`).
export async function getGuestProductDetailAction(
  token: string,
  productId: string,
) {
  return getGuestProductDetail(token, productId)
}
