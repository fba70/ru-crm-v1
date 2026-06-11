// Shared order display helpers — status labels/colors + currency/date
// formatting. Pure + client-safe (type-only schema import), used by the
// orders table and the order builder so the two never drift.

import type { OrderStatus } from "@/db/schema"

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  awaiting_client: "Awaiting client",
  confirmed: "Confirmed",
  finalized: "Finalized",
  cancelled: "Cancelled",
}

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  draft: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  awaiting_client: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  confirmed: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  finalized: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  cancelled: "bg-red-500/15 text-red-600 dark:text-red-400",
}

export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]

// `draft` + `awaiting_client` are the internally-editable states. Terminal
// states render the builder read-only (preview). See `refs/spec-guest-order-link.md`
// for the eventual ownership model that will tighten `awaiting_client`.
export function isOrderEditable(status: OrderStatus): boolean {
  return status === "draft" || status === "awaiting_client"
}

export function formatOrderAmount(amount: number, currency: string): string {
  try {
    return amount.toLocaleString("ru-RU", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  } catch {
    // Fall back gracefully if the stored currency isn't a valid ISO code.
    return `${amount.toLocaleString("ru-RU")} ${currency}`
  }
}

export function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}
