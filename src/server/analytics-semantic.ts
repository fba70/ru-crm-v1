import "server-only"

import { sql, type SQL } from "drizzle-orm"
import { execRows, withBase } from "@/server/analytics-query"
import {
  DEFAULT_TOP_N,
  DIMENSIONS,
  MAX_ROWS,
  MEASURES,
  isProductDimension,
  isTimeDimension,
  type AnalyticsQueryResult,
  type AnalyticsQuerySpec,
  type AnalyticsResultRow,
  type DimensionKey,
  type MeasureKey,
} from "@/lib/analytics-semantic"
import { clientTypeLabel, formatPeriod } from "@/lib/analytics-format"
import { CLIENT_TYPE_VALUES } from "@/lib/client-custom-fields"
import { ORDER_STATUS_LABEL } from "@/lib/orders-format"
import type { OrderStatus } from "@/db/schema"

// ── The semantic query engine ────────────────────────────────────────
//
// Turns a whitelisted {measure, dimension, splitBy, filters} spec into ONE
// aggregate over the same CTE the /analytics page uses (`withBase`), so the
// assistant's numbers are the dashboard's numbers by construction.
//
// Nothing here interpolates caller text into SQL: dimensions and measures are
// looked up in the maps below (compile-time keys), and every filter VALUE is a
// bound parameter. The organization id comes from the session at the call site.
//
// ── Grain ────────────────────────────────────────────────────────────
// Two grains, picked automatically:
//   • `order` — one row per order. The default.
//   • `item`  — one row per order LINE. Forced when a product dimension or the
//     `skus` measure is involved, because "revenue by country" means the
//     revenue of the matching product LINES, not of whole orders that happen to
//     contain one. Line revenue inherits the parent order's discount factor, so
//     both grains roll up to the same grand total.

type Grain = "order" | "item"

/** `key` is the stable identity (drives color); `label` is what a human reads. */
type DimExpr = { key: SQL; label: SQL; joins: JoinKey[] }

type JoinKey = "user" | "client" | "product" | "oagg"

const TIME_UNITS: Record<string, { unit: string; fmt: string }> = {
  "time.day": { unit: "day", fmt: "YYYY-MM-DD" },
  "time.week": { unit: "week", fmt: "YYYY-MM-DD" },
  "time.month": { unit: "month", fmt: "YYYY-MM" },
  "time.quarter": { unit: "quarter", fmt: "YYYY-MM" },
  "time.year": { unit: "year", fmt: "YYYY" },
}

const ORDER_VALUE_BUCKET_SQL = (col: SQL) => sql`case
  when ${col} <   50000 then '1'
  when ${col} <  100000 then '2'
  when ${col} <  250000 then '3'
  when ${col} <  500000 then '4'
  when ${col} < 1000000 then '5'
  else                       '6'
end`

/** Resolve a dimension to its (key, label) SQL for the given grain. */
function dimensionExpr(dim: DimensionKey, grain: Grain): DimExpr {
  const base = grain === "order" ? sql.raw("o") : sql.raw("li")

  const time = TIME_UNITS[dim]
  if (time) {
    const e = sql`to_char(date_trunc(${time.unit}, ${base}.order_date), ${time.fmt})`
    return { key: e, label: e, joins: [] }
  }

  switch (dim) {
    case "seller":
      return {
        key: sql`u.id`,
        label: sql`u.name`,
        joins: ["user"],
      }
    case "department":
      return {
        key: sql`coalesce(nullif(u.department, ''), 'Без отдела')`,
        label: sql`coalesce(nullif(u.department, ''), 'Без отдела')`,
        joins: ["user"],
      }
    case "clientType":
      return {
        key: sql`coalesce(nullif(c.custom_fields ->> 'type', ''), 'unknown')`,
        label: sql`coalesce(nullif(c.custom_fields ->> 'type', ''), 'unknown')`,
        joins: ["client"],
      }
    case "client":
      return { key: sql`c.id`, label: sql`c.name`, joins: ["client"] }
    case "status": {
      const e =
        grain === "order" ? sql`o.status` : sql`li.order_status`
      return { key: e, label: e, joins: [] }
    }
    case "orderValueBucket": {
      const e = ORDER_VALUE_BUCKET_SQL(
        grain === "order" ? sql`o.net` : sql`li.net`,
      )
      return { key: e, label: e, joins: [] }
    }
    case "product":
      return { key: sql`p.id`, label: sql`p.name`, joins: ["product"] }
    case "product.country":
    case "product.region":
    case "product.color":
    case "product.type":
    case "product.sugar": {
      const attr = {
        "product.country": "country_name",
        "product.region": "region",
        "product.color": "color",
        "product.type": "type",
        "product.sugar": "sugar",
      }[dim]
      const e = sql`coalesce(nullif(p.additional_metadata ->> ${attr}, ''), 'Не указано')`
      return { key: e, label: e, joins: ["product"] }
    }
  }
  // The time.* keys are handled above; anything else is not in the whitelist.
  throw new Error(`Unsupported dimension: ${dim}`)
}

/**
 * Measure expression. `bookedOnly` gates every aggregate to sold orders; it is
 * lifted when the caller is explicitly asking about order STATUS (otherwise a
 * status breakdown could only ever show the two booked statuses).
 */
function measureExpr(
  measure: MeasureKey,
  grain: Grain,
  bookedOnly: boolean,
): { expr: SQL; joins: JoinKey[] } {
  const gate = bookedOnly
    ? grain === "order"
      ? sql` filter (where o.booked)`
      : sql` filter (where li.booked)`
    : sql``

  if (grain === "order") {
    switch (measure) {
      case "revenue":
        return { expr: sql`coalesce(sum(o.net)${gate}, 0)::float8`, joins: [] }
      case "revenueGross":
        return { expr: sql`coalesce(sum(o.total)${gate}, 0)::float8`, joins: [] }
      case "discount":
        return { expr: sql`coalesce(sum(o.total - o.net)${gate}, 0)::float8`, joins: [] }
      case "orders":
        return { expr: sql`count(*)${gate}::float8`, joins: [] }
      case "units":
        return {
          expr: sql`coalesce(sum(oagg.units)${gate}, 0)::float8`,
          joins: ["oagg"],
        }
      case "avgOrderValue":
        return {
          expr: sql`(coalesce(sum(o.net)${gate}, 0) / nullif(count(*)${gate}, 0))::float8`,
          joins: [],
        }
      case "clients":
        return { expr: sql`count(distinct o.client_id)${gate}::float8`, joins: [] }
      case "skus":
        // Unreachable — `skus` forces item grain. Kept for exhaustiveness.
        return { expr: sql`0::float8`, joins: [] }
    }
  }

  switch (measure) {
    case "revenue":
      return { expr: sql`coalesce(sum(li.net)${gate}, 0)::float8`, joins: [] }
    case "revenueGross":
      return { expr: sql`coalesce(sum(li.gross)${gate}, 0)::float8`, joins: [] }
    case "discount":
      return { expr: sql`coalesce(sum(li.gross - li.net)${gate}, 0)::float8`, joins: [] }
    case "orders":
      return { expr: sql`count(distinct li.order_id)${gate}::float8`, joins: [] }
    case "units":
      return { expr: sql`coalesce(sum(li.quantity)${gate}, 0)::float8`, joins: [] }
    case "avgOrderValue":
      return {
        expr: sql`(coalesce(sum(li.net)${gate}, 0) / nullif(count(distinct li.order_id)${gate}, 0))::float8`,
        joins: [],
      }
    case "clients":
      return { expr: sql`count(distinct li.client_id)${gate}::float8`, joins: [] }
    case "skus":
      return { expr: sql`count(distinct li.product_id)${gate}::float8`, joins: [] }
  }
}

function joinSql(joins: Set<JoinKey>, grain: Grain): SQL {
  const base = grain === "order" ? sql.raw("o") : sql.raw("li")
  const parts: SQL[] = []
  if (joins.has("user")) parts.push(sql` join "user" u on u.id = ${base}.user_id`)
  if (joins.has("client")) parts.push(sql` join client c on c.id = ${base}.client_id`)
  if (joins.has("product")) parts.push(sql` join product p on p.id = li.product_id`)
  if (joins.has("oagg")) parts.push(sql` left join oagg on oagg.order_id = o.id`)
  return sql.join(parts, sql``)
}

const BUCKET_LABELS: Record<string, string> = {
  "1": "< 50 тыс",
  "2": "50–100 тыс",
  "3": "100–250 тыс",
  "4": "250–500 тыс",
  "5": "500 тыс – 1 млн",
  "6": "> 1 млн",
}

/** Human label for a raw dimension key. */
function labelFor(dim: DimensionKey, raw: string): string {
  if (isTimeDimension(dim)) return formatPeriod(raw, true)
  if (dim === "status") return ORDER_STATUS_LABEL[raw as OrderStatus] ?? raw
  if (dim === "clientType") return clientTypeLabel(raw)
  if (dim === "orderValueBucket") return BUCKET_LABELS[raw] ?? raw
  return raw
}

/**
 * Map a human-typed filter value back to the raw DB value.
 *
 * For enum-ish dimensions the SQL "label" IS the raw value («on_trade»,
 * «finalized») — the Russian label is applied in JS afterwards. So a model that
 * filters by what it saw on screen («On-trade», «Оформлен») would match nothing
 * unless we reverse the mapping here. Name-valued dimensions (seller, client)
 * are matched against their label in SQL instead, so they need no reversal.
 */
function resolveFilterValue(dim: DimensionKey, value: string): string {
  const v = value.trim().toLowerCase()
  if (dim === "status") {
    const hit = (Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).find(
      (s) => s === v || ORDER_STATUS_LABEL[s].toLowerCase() === v,
    )
    return hit ?? value
  }
  if (dim === "clientType") {
    const hit = CLIENT_TYPE_VALUES.find(
      (t) => t === v || clientTypeLabel(t).toLowerCase() === v,
    )
    return hit ?? value
  }
  if (dim === "orderValueBucket") {
    const hit = Object.entries(BUCKET_LABELS).find(
      ([code, label]) => code === v || label.toLowerCase() === v,
    )
    return hit?.[0] ?? value
  }
  return value
}

type RawRow = { k: string | null; l: string | null; sk: string | null; sl: string | null; v: number }

export async function runAnalyticsQuery(
  organizationId: string,
  spec: AnalyticsQuerySpec,
  bounds: { from: Date; to: Date },
): Promise<AnalyticsQueryResult> {
  const from = spec.from ? new Date(spec.from) : bounds.from
  const to = spec.to ? new Date(spec.to) : bounds.to
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    throw new Error("Invalid date range")
  if (to <= from) throw new Error("Range end must be after range start")

  const warnings: string[] = []
  const filters = (spec.filters ?? []).filter((f) => DIMENSIONS[f.dimension])

  // Grain: any product dimension anywhere, or the skus measure, forces line grain.
  const touched: DimensionKey[] = [
    ...(spec.dimension ? [spec.dimension] : []),
    ...(spec.splitBy ? [spec.splitBy] : []),
    ...filters.map((f) => f.dimension),
  ]
  const grain: Grain =
    spec.measure === "skus" || touched.some(isProductDimension) ? "item" : "order"

  // The booked gate is lifted only when the caller is explicitly slicing by
  // order status — otherwise a status breakdown could only show sold orders.
  const statusInvolved = touched.includes("status")
  const bookedOnly = !statusInvolved

  const joins = new Set<JoinKey>()
  const measure = measureExpr(spec.measure, grain, bookedOnly)
  measure.joins.forEach((j) => joins.add(j))

  const dim = spec.dimension ? dimensionExpr(spec.dimension, grain) : null
  dim?.joins.forEach((j) => joins.add(j))
  const split = spec.splitBy ? dimensionExpr(spec.splitBy, grain) : null
  split?.joins.forEach((j) => joins.add(j))

  // Filters: same whitelist as grouping, values always bound as parameters.
  const whereParts: SQL[] = []
  for (const f of filters) {
    const e = dimensionExpr(f.dimension, grain)
    e.joins.forEach((j) => joins.add(j))
    const value = resolveFilterValue(f.dimension, f.value)
    // Match the raw key OR the display label, case-insensitively: name-valued
    // dimensions (seller, client) arrive as names, enum ones as raw values
    // after `resolveFilterValue` has reversed any Russian label.
    whereParts.push(
      sql`(lower(${e.key}::text) = lower(${value}) or lower(${e.label}::text) = lower(${value}))`,
    )
  }

  const base = withBase(organizationId, from, to)
  const fromTable = grain === "order" ? sql.raw(`o`) : sql.raw(`li`)
  const where = whereParts.length
    ? sql` where ${sql.join(whereParts, sql` and `)}`
    : sql``

  // ── Scalar ─────────────────────────────────────────────────────────
  if (!dim) {
    const rows = await execRows<{ v: number }>(sql`
      ${base}
      select ${measure.expr} as v
      from ${fromTable}${joinSql(joins, grain)}${where}
    `)
    const scalar = Number(rows[0]?.v ?? 0)
    return {
      spec,
      rows: [],
      scalar,
      meta: {
        measureLabel: MEASURES[spec.measure].label,
        measureKind: MEASURES[spec.measure].kind,
        dimensionLabel: null,
        splitLabel: null,
        total: scalar,
        rowCount: 0,
        truncated: false,
        from: from.toISOString(),
        to: to.toISOString(),
        grain,
        chart: "table",
        warnings,
      },
    }
  }

  // ── Breakdown ──────────────────────────────────────────────────────
  const isTime = isTimeDimension(spec.dimension!)
  const topN = Math.min(
    Math.max(spec.topN ?? (isTime ? MAX_ROWS : DEFAULT_TOP_N), 1),
    MAX_ROWS,
  )
  // Time reads chronologically; everything else ranks by the measure.
  const orderBy =
    isTime || spec.sort === "label"
      ? sql`1 asc`
      : sql`5 desc nulls last`
  const limit = topN * (split ? 8 : 1)

  const rows = await execRows<RawRow>(sql`
    ${base}
    select
      ${dim.key}::text                                as k,
      ${dim.label}::text                              as l,
      ${split ? sql`${split.key}::text` : sql`null::text`}   as sk,
      ${split ? sql`${split.label}::text` : sql`null::text`} as sl,
      ${measure.expr}                                 as v
    from ${fromTable}${joinSql(joins, grain)}${where}
    group by 1, 2, 3, 4
    order by ${orderBy}
    limit ${Math.min(limit, MAX_ROWS * 4)}
  `)

  if (filters.length && rows.length === 0) {
    warnings.push(
      "Фильтр не совпал ни с одной записью — возможно, значение указано неточно.",
    )
  }

  let out: AnalyticsResultRow[] = rows.map((r) => ({
    key: r.k ?? "—",
    label: labelFor(spec.dimension!, r.l ?? "—"),
    value: Number(r.v ?? 0),
    ...(split
      ? {
          splitKey: r.sk ?? "—",
          splitLabel: labelFor(spec.splitBy!, r.sl ?? "—"),
        }
      : {}),
  }))

  // With a split, `limit` applies to (dimension × split) pairs — trim to the
  // top-N dimension values by their summed measure so the chart stays legible.
  let truncated = false
  if (split) {
    const totals = new Map<string, number>()
    for (const r of out) totals.set(r.key, (totals.get(r.key) ?? 0) + r.value)
    const ranked = [...totals.entries()]
      .sort((a, b) => (isTime ? a[0].localeCompare(b[0]) : b[1] - a[1]))
      .slice(0, topN)
      .map(([k]) => k)
    const keep = new Set(ranked)
    truncated = totals.size > keep.size
    out = out.filter((r) => keep.has(r.key))
  } else if (out.length > topN) {
    truncated = true
    out = out.slice(0, topN)
  }

  // Time series always read left→right in chronological order.
  if (isTime) out.sort((a, b) => a.key.localeCompare(b.key))

  const total = out.reduce((s, r) => s + r.value, 0)

  return {
    spec,
    rows: out,
    scalar: null,
    meta: {
      measureLabel: MEASURES[spec.measure].label,
      measureKind: MEASURES[spec.measure].kind,
      dimensionLabel: DIMENSIONS[spec.dimension!].label,
      splitLabel: spec.splitBy ? DIMENSIONS[spec.splitBy].label : null,
      total,
      rowCount: out.length,
      truncated,
      from: from.toISOString(),
      to: to.toISOString(),
      grain,
      chart: resolveChart(spec, isTime, Boolean(split), out.length),
      warnings,
    },
  }
}

/**
 * Honour the model's chart choice when it's viable, else fall back to the form
 * the data actually supports (a donut of 30 slices helps nobody).
 */
function resolveChart(
  spec: AnalyticsQuerySpec,
  isTime: boolean,
  hasSplit: boolean,
  rowCount: number,
): AnalyticsQueryResult["meta"]["chart"] {
  const wanted = spec.chart
  if (hasSplit) return "stackedBar"
  if (wanted === "donut") return rowCount <= 6 ? "donut" : "bar"
  if (wanted === "line" || wanted === "area") return isTime ? wanted : "bar"
  if (wanted === "table") return "table"
  if (wanted === "bar") return "bar"
  return isTime ? "line" : "bar"
}
