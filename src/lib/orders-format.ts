// Shared order display helpers — status labels/colors + currency/date
// formatting. Pure + client-safe (type-only schema import), used by the
// orders table and the order builder so the two never drift.

import type { OrderStatus } from "@/db/schema"

// UI display labels (Russian). The DB enum values (draft / awaiting_client /
// …) stay English — only what the operator sees is translated.
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Черновик",
  awaiting_client: "Ожидает клиента",
  confirmed: "Подтверждён",
  finalized: "Оформлен",
  cancelled: "Отменён",
}

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  draft: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  awaiting_client: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  confirmed: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  finalized: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  cancelled: "bg-red-500/15 text-red-600 dark:text-red-400",
}

export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]

// Only `draft` is internally editable. Once an order is sent
// (`awaiting_client`) the CLIENT owns it — internal item edits are blocked
// until the user pulls it back to draft (which revokes the live link). Every
// other status is a read-only preview. This is the ownership model from
// `refs/spec-guest-order-link.md` (FR-10).
// Internally editable statuses. `draft` (not yet sent) and `confirmed` (the
// client reviewed + returned it, so the internal user owns it again and may
// adjust line items before finalizing). `awaiting_client` belongs to the
// client; `finalized` / `cancelled` are terminal.
export function isOrderEditable(status: OrderStatus): boolean {
  return status === "draft" || status === "confirmed"
}

// Structural email check (not RFC-exhaustive) — gates sending an order to a
// client, since `awaiting_client` requires a deliverable recipient.
export function isValidEmail(value: string): boolean {
  const v = value.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
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

// Apply a whole-percent discount to an order subtotal. Returns the clamped
// percent, the rounded discount amount, and the discounted total. Pure +
// client-safe so the orders table, the order builder, and the guest page all
// derive the same numbers from `(totalAmount, discountPercent)` — the order
// stores only the percent; the amounts are always derived.
export function computeOrderDiscount(
  total: number,
  percentRaw: number,
): { percent: number; discountAmount: number; discountedTotal: number } {
  const percent = Number.isFinite(percentRaw)
    ? Math.min(Math.max(percentRaw, 0), 100)
    : 0
  const t = Number.isFinite(total) ? total : 0
  const discountAmount = Math.round(t * percent) / 100
  const discountedTotal = Math.max(0, Math.round((t - discountAmount) * 100) / 100)
  return { percent, discountAmount, discountedTotal }
}

export function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}
