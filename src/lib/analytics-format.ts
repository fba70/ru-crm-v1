// Analytics display layer — palette, labels and number formatting for the
// «Аналитика» page. Pure + client-safe (type-only schema imports), so the
// server aggregator (`src/server/analytics.ts`), the API route and every chart
// component share one source of truth and can never drift.

import type { OrderStatus } from "@/db/schema"
import { CLIENT_TYPE_LABELS, isClientType } from "@/lib/client-custom-fields"

// ── Domain constants ─────────────────────────────────────────────────

/**
 * Order statuses that count as SOLD. `finalized` is the completed terminal
 * state of the order lifecycle; `confirmed` is "client signed off, internally
 * owned again" — money the business has booked. Everything else (`draft`,
 * `awaiting_client`, `cancelled`) is pipeline and is excluded from every
 * revenue / units / product figure.
 */
export const BOOKED_ORDER_STATUSES = ["finalized", "confirmed"] as const

/**
 * Catalog attributes (keys inside `product.additional_metadata`) the product
 * analytics slice by. This tuple is also the SQL whitelist — `getSalesAnalytics`
 * only ever interpolates values from here, never anything user-supplied.
 */
export const PRODUCT_ATTRIBUTE_KEYS = [
  "country_name",
  "region",
  "color",
  "type",
  "sugar",
] as const

export type ProductAttributeKey = (typeof PRODUCT_ATTRIBUTE_KEYS)[number]

export const PRODUCT_ATTRIBUTE_LABELS: Record<ProductAttributeKey, string> = {
  country_name: "Страна происхождения",
  region: "Регион",
  color: "Цвет",
  type: "Тип",
  sugar: "Сахар",
}

/** Placeholder the SQL uses for products missing an attribute. */
export const UNSPECIFIED = "Не указано"

// ── Palette ──────────────────────────────────────────────────────────
//
// The app's own `--chart-1..5` tokens are four blues plus a salmon — fine for
// one or two series, but as a CATEGORICAL set they collapse (three of the five
// share a hue), so they can't carry an 8-way country or department breakdown.
//
// These eight hues are the validated categorical order, re-checked against this
// app's real chart surfaces (light `--card` #ffffff, dark `--card` #2a3040):
//
//   light — adjacent CVD ΔE 9.1 (protan), normal-vision ΔE 19.6 → PASS
//   dark  — adjacent CVD ΔE 8.4 (protan), normal-vision ΔE 19.3 → PASS
//
// Both modes WARN on contrast for the mid-lightness hues, which obliges
// "relief": every chart here ships a legend, and every tab carries a data table
// of the same numbers. Slots are assigned in FIXED ORDER and keyed to the
// entity — filtering a series never repaints the survivors. Past eight
// categories the tail folds into «Прочее»; hues are never cycled or generated.
export const SERIES_COLORS: { light: string; dark: string }[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // 1 blue
  { light: "#eb6834", dark: "#d95926" }, // 2 orange
  { light: "#1baf7a", dark: "#199e70" }, // 3 aqua
  { light: "#eda100", dark: "#c98500" }, // 4 yellow
  { light: "#e87ba4", dark: "#d55181" }, // 5 magenta
  { light: "#008300", dark: "#008300" }, // 6 green
  { light: "#4a3aa7", dark: "#9085e9" }, // 7 violet
  { light: "#e34948", dark: "#e66767" }, // 8 red
]

/** Max categorical slices before the tail folds into «Прочее». */
export const MAX_SERIES = SERIES_COLORS.length

export const OTHER_LABEL = "Прочее"

/** Neutral for the folded tail + de-emphasised marks. */
export const MUTED_SERIES = { light: "#9ca3af", dark: "#6b7280" }

export const seriesColor = (index: number) =>
  SERIES_COLORS[index % SERIES_COLORS.length]

/**
 * Status palette — RESERVED for order state, never reused as a series color.
 * Ordered along the funnel (cancelled → draft → awaiting → confirmed →
 * finalized) because that's the stacking order, and the CVD gates are checked
 * on ADJACENT pairs: worst adjacent ΔE 8.2 light / 10.2 dark (protan),
 * normal-vision 21.6 / 17.3 — both clear.
 *
 * `draft` is deliberately a low-chroma neutral and so sits below the chroma
 * floor that the categorical check enforces. That check exists to stop a HUE
 * from accidentally reading as gray; here gray IS the meaning — "nothing has
 * happened to this order yet" — the same exception a diverging scale's neutral
 * midpoint gets. Its separation from its neighbours still passes both gates.
 */
export const STATUS_COLORS: Record<OrderStatus, { light: string; dark: string }> =
  {
    cancelled: { light: "#e34948", dark: "#e66767" },
    draft: { light: "#6b7280", dark: "#8b94a8" },
    awaiting_client: { light: "#eda100", dark: "#c98500" },
    confirmed: { light: "#2a78d6", dark: "#3987e5" },
    finalized: { light: "#1baf7a", dark: "#199e70" },
  }

/** Funnel order — used for stacking and for the status legend. */
export const STATUS_ORDER: OrderStatus[] = [
  "draft",
  "awaiting_client",
  "confirmed",
  "finalized",
  "cancelled",
]

// ── Labels ───────────────────────────────────────────────────────────

/** Client `custom_fields.type`, with a bucket for clients that have none. */
export function clientTypeLabel(value: string): string {
  if (isClientType(value)) return CLIENT_TYPE_LABELS[value]
  return "Без типа"
}

export const ORDER_VALUE_BUCKET_LABELS: Record<string, string> = {
  "1": "< 50 тыс",
  "2": "50–100 тыс",
  "3": "100–250 тыс",
  "4": "250–500 тыс",
  "5": "500 тыс – 1 млн",
  "6": "> 1 млн",
}

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
]

/**
 * Render a period key (`YYYY` / `YYYY-MM` / `YYYY-MM-DD`) for an axis or a
 * tooltip. `long` spells out the year on monthly keys — used in tooltips where
 * there's room, while the axis stays terse.
 */
export function formatPeriod(period: string, long = false): string {
  const parts = period.split("-")
  if (parts.length === 1) return period
  const month = MONTHS_SHORT[Number(parts[1]) - 1] ?? parts[1]
  if (parts.length === 2) return long ? `${month} ${parts[0]}` : month
  return long ? `${Number(parts[2])} ${month} ${parts[0]}` : `${Number(parts[2])} ${month}`
}

// ── Numbers ──────────────────────────────────────────────────────────

const ru = (n: number, digits = 0) =>
  n.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

/**
 * Compact money for axes and stat tiles: `181,3 млн ₽`.
 *
 * The decimal is dropped once the scaled number reaches three digits
 * (`160 млн ₽`, not `160,0 млн ₽`) — the extra glyph pushes the string past the
 * y-axis gutter and recharts wraps the tick onto two lines.
 */
export function formatMoney(value: number): string {
  const abs = Math.abs(value)
  const scaled = (divisor: number, unit: string) => {
    const n = value / divisor
    return `${ru(n, Math.abs(n) >= 100 ? 0 : 1)} ${unit} ₽`
  }
  if (abs >= 1e9) return scaled(1e9, "млрд")
  if (abs >= 1e6) return scaled(1e6, "млн")
  if (abs >= 1e3) return `${ru(value / 1e3, 0)} тыс ₽`
  return `${ru(value)} ₽`
}

/** Exact money for tables and tooltips: `181 270 297 ₽`. */
export function formatMoneyFull(value: number): string {
  return `${ru(Math.round(value))} ₽`
}

export function formatNumber(value: number): string {
  return ru(value)
}

export function formatPercent(value: number, digits = 1): string {
  return `${ru(value * 100, digits)}%`
}

/** Signed period-over-period change, or `null` when there's no base to compare. */
export function delta(current: number, previous: number): number | null {
  if (!previous) return null
  return (current - previous) / previous
}

/**
 * Fold a sorted-descending slice list to the categorical ceiling, summing the
 * tail into «Прочее». Never generates a 9th hue.
 */
export function foldTail<T extends { label: string; revenue: number; orders: number; units: number }>(
  rows: T[],
  limit = MAX_SERIES,
): { label: string; revenue: number; orders: number; units: number }[] {
  if (rows.length <= limit) return rows
  const head = rows.slice(0, limit - 1)
  const tail = rows.slice(limit - 1)
  return [
    ...head,
    {
      label: OTHER_LABEL,
      revenue: tail.reduce((s, r) => s + r.revenue, 0),
      orders: tail.reduce((s, r) => s + r.orders, 0),
      units: tail.reduce((s, r) => s + r.units, 0),
    },
  ]
}
