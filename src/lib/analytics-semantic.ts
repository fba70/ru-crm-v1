// The analytics semantic model — the vocabulary the AI assistant is allowed to
// speak, and the single place to tune or extend it.
//
// The assistant never writes SQL. It picks a MEASURE, an optional DIMENSION to
// break it down by, an optional second dimension to split by, and filters — all
// from the whitelists below. `runAnalyticsQuery` (src/server/analytics-semantic.ts)
// turns that into one aggregate query over the same CTE the /analytics page uses,
// so a number in the chat can never contradict the same number on the dashboard.
//
// Client-safe (pure data + types): the tool definition, the system prompt, the
// answer card and the suggestion chips all read from here.
//
// ── Extending the model ──────────────────────────────────────────────
//   • a new measure    → add to MEASURES + a SQL expression in analytics-semantic.ts
//   • a new dimension  → add to DIMENSIONS + a SQL expression there
//   • a new chip       → just append to SUGGESTION_CHIPS below (no other change)
// The tool's Zod enums and the system prompt are GENERATED from these objects,
// so adding an entry teaches the model about it automatically.

// ── Measures ─────────────────────────────────────────────────────────

export type MeasureKey =
  | "revenue"
  | "revenueGross"
  | "discount"
  | "orders"
  | "units"
  | "avgOrderValue"
  | "clients"
  | "skus"

export type MeasureDef = {
  label: string
  /** `money` renders as ₽; `count` as a plain number. */
  kind: "money" | "count"
  /** Shown to the model so it picks the right measure. */
  hint: string
}

export const MEASURES: Record<MeasureKey, MeasureDef> = {
  revenue: {
    label: "Выручка",
    kind: "money",
    hint: "Net booked revenue (after the per-client discount). THE DEFAULT measure for any money question.",
  },
  revenueGross: {
    label: "Выручка до скидок",
    kind: "money",
    hint: "Catalog subtotal before the discount. Only when explicitly asked about pre-discount amounts.",
  },
  discount: {
    label: "Скидки",
    kind: "money",
    hint: "Money given away as discount (gross − net).",
  },
  orders: {
    label: "Заказы",
    kind: "count",
    hint: "Number of booked orders.",
  },
  units: {
    label: "Продано единиц",
    kind: "count",
    hint: "Physical quantity of product sold (bottles/items).",
  },
  avgOrderValue: {
    label: "Средний чек",
    kind: "money",
    hint: "Revenue divided by the number of booked orders.",
  },
  clients: {
    label: "Клиенты",
    kind: "count",
    hint: "Distinct clients that placed a booked order.",
  },
  skus: {
    label: "Товарные позиции",
    kind: "count",
    hint: "Distinct products sold (unique SKUs).",
  },
}

// ── Dimensions ───────────────────────────────────────────────────────

export type DimensionKey =
  | "time.day"
  | "time.week"
  | "time.month"
  | "time.quarter"
  | "time.year"
  | "seller"
  | "department"
  | "clientType"
  | "client"
  | "status"
  | "orderValueBucket"
  | "product.country"
  | "product.region"
  | "product.color"
  | "product.type"
  | "product.sugar"
  | "product"

export type DimensionDef = {
  label: string
  hint: string
  /** Time dimensions sort chronologically and default to a line/area chart. */
  isTime?: boolean
  /**
   * Product dimensions force LINE-ITEM grain: the numbers then describe the
   * matching product lines, not whole orders.
   */
  isProduct?: boolean
}

export const DIMENSIONS: Record<DimensionKey, DimensionDef> = {
  "time.day": { label: "По дням", hint: "Daily. Only when explicitly asked for days.", isTime: true },
  "time.week": { label: "По неделям", hint: "Weekly.", isTime: true },
  "time.month": { label: "По месяцам", hint: "Monthly — the DEFAULT time breakdown.", isTime: true },
  "time.quarter": { label: "По кварталам", hint: "Quarterly.", isTime: true },
  "time.year": { label: "По годам", hint: "Yearly.", isTime: true },
  seller: { label: "Сотрудник", hint: "The salesperson who owns the order." },
  department: { label: "Отдел", hint: "The salesperson's department («Отдел 1/2/3»)." },
  clientType: { label: "Тип клиента", hint: "on-trade / off-trade / own needs / internet shop." },
  client: { label: "Клиент", hint: "The buying company." },
  status: { label: "Статус заказа", hint: "Order lifecycle status. Use with measure=orders." },
  orderValueBucket: { label: "Размер заказа", hint: "Order-size band (<50k, 50–100k, …)." },
  "product.country": { label: "Страна происхождения", hint: "Product country of origin." },
  "product.region": { label: "Регион", hint: "Product region." },
  "product.color": { label: "Цвет", hint: "Product colour (КРАСНЫЙ / БЕЛЫЙ / …)." },
  "product.type": { label: "Тип товара", hint: "Product type (ВИНО / ВИСКИ / ВОДКА / …)." },
  "product.sugar": { label: "Сахар", hint: "Sugar level (СУХОЕ / БРЮТ / …)." },
  product: { label: "Товар", hint: "Individual product. Use with a small topN." },
}

export const MEASURE_KEYS = Object.keys(MEASURES) as MeasureKey[]
export const DIMENSION_KEYS = Object.keys(DIMENSIONS) as DimensionKey[]

export const isTimeDimension = (d: DimensionKey) => DIMENSIONS[d].isTime === true
export const isProductDimension = (d: DimensionKey) =>
  DIMENSIONS[d].isProduct === true || d.startsWith("product")

// ── Chart forms the assistant may choose ─────────────────────────────

export type AnswerChart = "bar" | "line" | "area" | "donut" | "stackedBar" | "table"

export const CHART_HINTS: Record<AnswerChart, string> = {
  bar: "Ranked comparison across named things (sellers, countries, clients). The default for non-time breakdowns.",
  line: "Trend over time. Use for time dimensions.",
  area: "Trend over time with a filled region — for a single cumulative-feeling series.",
  donut: "Part-to-whole share. ONLY for 2–6 categories.",
  stackedBar: "Composition over time. REQUIRES splitBy.",
  table: "Many rows, or several measures worth reading exactly.",
}

// ── Query + result contract ──────────────────────────────────────────

export type AnalyticsFilter = { dimension: DimensionKey; value: string }

export type AnalyticsQuerySpec = {
  measure: MeasureKey
  /** Omit for a single scalar (answered in prose, no chart). */
  dimension?: DimensionKey
  /** Second breakdown → a stacked/grouped result. */
  splitBy?: DimensionKey
  filters?: AnalyticsFilter[]
  from?: string
  to?: string
  topN?: number
  sort?: "measure" | "label"
  chart?: AnswerChart
}

export type AnalyticsResultRow = {
  /** Stable identity (raw DB value / period key) — drives color assignment. */
  key: string
  /** Display label. */
  label: string
  value: number
  /** Present when `splitBy` was used. */
  splitKey?: string
  splitLabel?: string
}

export type AnalyticsQueryResult = {
  spec: AnalyticsQuerySpec
  /** Empty when the query is a scalar. */
  rows: AnalyticsResultRow[]
  scalar: number | null
  meta: {
    measureLabel: string
    measureKind: "money" | "count"
    dimensionLabel: string | null
    splitLabel: string | null
    /** Sum over rows (or the scalar). */
    total: number
    rowCount: number
    truncated: boolean
    from: string
    to: string
    grain: "order" | "item"
    chart: AnswerChart
    /** Set when a filter value matched nothing — the model must say so. */
    warnings: string[]
  }
}

/** Row cap. Time series get more headroom; everything else stays chart-sized. */
export const MAX_ROWS = 400
export const DEFAULT_TOP_N = 12

// ── Suggestion chips (tune / extend freely) ──────────────────────────
//
// Shown above the composer when the conversation is empty. Purely a UI
// affordance — each chip just sends its text as a user message, so adding one
// needs no server change. Keep them answerable by the model above.

export type SuggestionChip = { label: string; prompt: string }

export const SUGGESTION_CHIPS: SuggestionChip[] = [
  {
    label: "Выручка по месяцам",
    prompt: "Покажи динамику выручки по месяцам",
  },
  {
    label: "Лучшие продавцы",
    prompt: "Кто лучший продавец за период? Покажи рейтинг по выручке",
  },
  {
    label: "On-trade и off-trade",
    prompt: "Сравни on-trade и off-trade по выручке по месяцам",
  },
  {
    label: "Топ стран",
    prompt: "Какие страны происхождения дали больше всего выручки?",
  },
  {
    label: "Отделы",
    prompt: "Сравни отделы по выручке и среднему чеку",
  },
  {
    label: "Средний чек",
    prompt: "Какой средний чек за период?",
  },
  {
    label: "Что продаётся",
    prompt: "Какие типы товаров продаются лучше всего по количеству?",
  },
  {
    label: "Топ клиентов",
    prompt: "Покажи топ-10 клиентов по выручке",
  },
]
