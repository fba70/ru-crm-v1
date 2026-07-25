import { db } from "@/db/drizzle"
import { sql, type SQL } from "drizzle-orm"
import {
  BOOKED_ORDER_STATUSES,
  PRODUCT_ATTRIBUTE_KEYS,
  type ProductAttributeKey,
} from "@/lib/analytics-format"

// ── Sales analytics: the queries ─────────────────────────────────────
//
// Pure aggregation over one organization's order book. This module knows
// NOTHING about sessions — the caller must have already established which org
// it is allowed to read. `src/server/analytics.ts` is that gate, and is what
// the API route uses; keeping the two apart means the org scope is a single
// explicit argument rather than ambient request state, and lets offline jobs
// (reports, seeds, checks) reuse the exact same numbers.
//
// One org-scoped read of the order book, aggregated entirely in SQL. Every
// figure on /analytics comes from a single `getSalesAnalytics()` call so the
// KPI row, the charts and the tables can never disagree with each other.
//
// Two definitions the whole module hangs on:
//
//   • BOOKED — `finalized` (this app's completed/sold terminal state) plus
//     `confirmed` (client has signed off; internally owned again). Revenue,
//     units and product analytics count ONLY booked orders. `draft`,
//     `awaiting_client` and `cancelled` still show up in the order-status and
//     conversion views — they're pipeline, not sales.
//   • NET — `total_amount` is the catalog subtotal; `discount_percent` is the
//     per-client discount snapshotted on the order. The headline money figure
//     is net of that discount (`total × (1 − pct/100)`), matching what the
//     orders table and the guest page show. Gross is kept alongside so the
//     discount give-away is visible rather than silently baked in.
//
// The line-item CTE inherits the parent order's discount factor, so
// per-product revenue rolls up to exactly the same total as per-order revenue.

export type AnalyticsRange = { from: string; to: string }

export type AnalyticsTotals = {
  revenue: number
  revenueGross: number
  discountAmount: number
  orders: number
  ordersBooked: number
  avgOrderValue: number
  units: number
  positions: number
  clients: number
  skus: number
  sellers: number
  bookedRate: number
}

/** One point on a time axis. `period` is a sortable key (YYYY / YYYY-MM / YYYY-MM-DD). */
export type TimePoint = {
  period: string
  revenue: number
  orders: number
  ordersBooked: number
  units: number
  clients: number
  avgOrderValue: number
}

/** A generic "sliced by something" row — sellers, departments, countries, … */
export type SliceRow = {
  key: string
  label: string
  revenue: number
  orders: number
  units: number
  clients?: number
  avgOrderValue?: number
  extra?: string | null
}

/** A stacked series point: one period, one value per stack key. */
export type StackPoint = { period: string } & Record<string, number | string>

export type StatusRow = {
  status: string
  orders: number
  amount: number
  amountNet: number
}

export type ClientScatterPoint = {
  id: string
  name: string
  type: string
  orders: number
  revenue: number
  avgOrderValue: number
}

export type ProductRow = {
  id: string
  name: string
  country: string | null
  type: string | null
  revenue: number
  units: number
  orders: number
}

export type SalesAnalytics = {
  range: AnalyticsRange
  /** Previous window of equal length — powers the KPI deltas. */
  previousRange: AnalyticsRange
  totals: AnalyticsTotals
  previousTotals: AnalyticsTotals
  timeseries: {
    daily: TimePoint[]
    monthly: TimePoint[]
    annual: TimePoint[]
  }
  sellers: SliceRow[]
  departments: SliceRow[]
  departmentMonthly: StackPoint[]
  departmentKeys: string[]
  clientTypes: SliceRow[]
  clientTypeMonthly: StackPoint[]
  clientTypeKeys: string[]
  topClients: SliceRow[]
  clientScatter: ClientScatterPoint[]
  statuses: StatusRow[]
  statusMonthly: StackPoint[]
  orderValueBuckets: { bucket: string; orders: number; revenue: number }[]
  products: Record<ProductAttributeKey, SliceRow[]>
  topProducts: ProductRow[]
}

// neon-http's db.execute resolves to `{ rows }`; normalise either shape.
async function execRows<T>(query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows?: T[] } | T[]
  return (Array.isArray(res) ? res : (res.rows ?? [])) as T[]
}

const BOOKED = sql.raw(
  BOOKED_ORDER_STATUSES.map((s) => `'${s}'`).join(", "),
)

/**
 * The shared `WITH` prefix every query below builds on.
 *
 *   o  — orders in scope, with the discount factor `f` and the `booked` flag
 *        precomputed once.
 *   li — line items of those orders, each carrying its parent's date/status so
 *        product slices can be filtered and bucketed without re-joining.
 */
function withBase(organizationId: string, from: Date, to: Date): SQL {
  return sql`
    with o as (
      select
        o.id,
        o.order_date,
        o.status::text                                              as status,
        o.client_id,
        o.user_id,
        o.total_amount::float8                                      as total,
        (1 - o.discount_percent::float8 / 100.0)                    as f,
        (o.total_amount::float8 * (1 - o.discount_percent::float8 / 100.0)) as net,
        (o.status::text in (${BOOKED}))                             as booked
      from "order" o
      where o.organization_id = ${organizationId}
        and o.order_date >= ${from}
        and o.order_date < ${to}
    ),
    li as (
      select
        oi.order_id,
        oi.product_id,
        oi.quantity::int                        as quantity,
        (oi.position_price::float8 * o.f)       as net,
        o.order_date,
        o.booked,
        o.client_id,
        o.user_id
      from order_item oi
      join o on o.id = oi.order_id
    ),
    oagg as (
      select order_id, sum(quantity)::int as units, count(*)::int as positions
      from li group by order_id
    )
  `
}

type TotalsRow = {
  orders: number
  orders_booked: number
  gross: number
  net: number
  clients: number
  sellers: number
  units: number
  positions: number
  skus: number
}

async function loadTotals(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<AnalyticsTotals> {
  const base = withBase(organizationId, from, to)
  const rows = await execRows<TotalsRow>(sql`
    ${base}
    select
      (select count(*)::int from o)                                             as orders,
      (select count(*)::int from o where booked)                                as orders_booked,
      (select coalesce(sum(total), 0)::float8 from o where booked)              as gross,
      (select coalesce(sum(net), 0)::float8 from o where booked)                as net,
      (select count(distinct client_id)::int from o where booked)               as clients,
      (select count(distinct user_id)::int from o where booked)                 as sellers,
      (select coalesce(sum(quantity), 0)::int from li where booked)             as units,
      (select count(*)::int from li where booked)                               as positions,
      (select count(distinct product_id)::int from li where booked)             as skus
  `)
  const r = rows[0]
  const revenue = r?.net ?? 0
  const ordersBooked = r?.orders_booked ?? 0
  const orders = r?.orders ?? 0
  return {
    revenue,
    revenueGross: r?.gross ?? 0,
    discountAmount: (r?.gross ?? 0) - revenue,
    orders,
    ordersBooked,
    avgOrderValue: ordersBooked > 0 ? revenue / ordersBooked : 0,
    units: r?.units ?? 0,
    positions: r?.positions ?? 0,
    clients: r?.clients ?? 0,
    skus: r?.skus ?? 0,
    sellers: r?.sellers ?? 0,
    bookedRate: orders > 0 ? ordersBooked / orders : 0,
  }
}

type TimeRow = {
  period: string
  revenue: number
  orders: number
  orders_booked: number
  units: number
  clients: number
}

async function loadTimeseries(
  organizationId: string,
  from: Date,
  to: Date,
  unit: "day" | "month" | "year",
): Promise<TimePoint[]> {
  const fmt = { day: "YYYY-MM-DD", month: "YYYY-MM", year: "YYYY" }[unit]
  const base = withBase(organizationId, from, to)
  const rows = await execRows<TimeRow>(sql`
    ${base}
    select
      to_char(date_trunc(${unit}, o.order_date), ${fmt})              as period,
      coalesce(sum(o.net) filter (where o.booked), 0)::float8         as revenue,
      count(*)::int                                                   as orders,
      count(*) filter (where o.booked)::int                           as orders_booked,
      coalesce(sum(oagg.units) filter (where o.booked), 0)::int       as units,
      count(distinct o.client_id) filter (where o.booked)::int        as clients
    from o
    left join oagg on oagg.order_id = o.id
    group by 1
    order by 1
  `)
  return rows.map((r) => ({
    period: r.period,
    revenue: r.revenue,
    orders: r.orders,
    ordersBooked: r.orders_booked,
    units: r.units,
    clients: r.clients,
    avgOrderValue: r.orders_booked > 0 ? r.revenue / r.orders_booked : 0,
  }))
}

type SliceSqlRow = {
  key: string
  label: string
  extra: string | null
  revenue: number
  orders: number
  units: number
  clients: number
}

const toSlice = (r: SliceSqlRow): SliceRow => ({
  key: r.key,
  label: r.label,
  extra: r.extra,
  revenue: r.revenue,
  orders: r.orders,
  units: r.units,
  clients: r.clients,
  avgOrderValue: r.orders > 0 ? r.revenue / r.orders : 0,
})

// ── the one public entry point ───────────────────────────────────────

export async function computeSalesAnalytics(params: {
  organizationId: string
  from: string
  to: string
}): Promise<SalesAnalytics> {
  const { organizationId } = params

  const from = new Date(params.from)
  const to = new Date(params.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Invalid date range")
  }
  if (to <= from) throw new Error("Range end must be after range start")

  // Equal-length preceding window for the KPI deltas.
  const spanMs = to.getTime() - from.getTime()
  const prevFrom = new Date(from.getTime() - spanMs)
  const prevTo = new Date(from.getTime())

  const base = withBase(organizationId, from, to)

  const [totals, previousTotals, daily, monthly, annual] = await Promise.all([
    loadTotals(organizationId, from, to),
    loadTotals(organizationId, prevFrom, prevTo),
    loadTimeseries(organizationId, from, to, "day"),
    loadTimeseries(organizationId, from, to, "month"),
    loadTimeseries(organizationId, from, to, "year"),
  ])

  const [
    sellersRaw,
    departmentsRaw,
    departmentMonthlyRaw,
    clientTypesRaw,
    clientTypeMonthlyRaw,
    topClientsRaw,
    clientScatter,
    statuses,
    statusMonthlyRaw,
    orderValueBuckets,
    topProducts,
  ] = await Promise.all([
    // Sellers — booked revenue per user, with their department alongside.
    execRows<SliceSqlRow>(sql`
      ${base}
      select
        u.id                                                        as key,
        u.name                                                      as label,
        coalesce(nullif(u.department, ''), '—')                     as extra,
        coalesce(sum(o.net) filter (where o.booked), 0)::float8      as revenue,
        count(*) filter (where o.booked)::int                        as orders,
        coalesce(sum(oagg.units) filter (where o.booked), 0)::int    as units,
        count(distinct o.client_id) filter (where o.booked)::int     as clients
      from o
      join "user" u on u.id = o.user_id
      left join oagg on oagg.order_id = o.id
      group by 1, 2, 3
      order by revenue desc
    `),
    // Departments — the same roll-up one level up.
    execRows<SliceSqlRow>(sql`
      ${base}
      select
        coalesce(nullif(u.department, ''), 'Без отдела')             as key,
        coalesce(nullif(u.department, ''), 'Без отдела')             as label,
        null::text                                                   as extra,
        coalesce(sum(o.net) filter (where o.booked), 0)::float8      as revenue,
        count(*) filter (where o.booked)::int                        as orders,
        coalesce(sum(oagg.units) filter (where o.booked), 0)::int    as units,
        count(distinct o.client_id) filter (where o.booked)::int     as clients
      from o
      join "user" u on u.id = o.user_id
      left join oagg on oagg.order_id = o.id
      group by 1, 2
      order by revenue desc
    `),
    execRows<{ period: string; stack: string; value: number }>(sql`
      ${base}
      select
        to_char(date_trunc('month', o.order_date), 'YYYY-MM')        as period,
        coalesce(nullif(u.department, ''), 'Без отдела')             as stack,
        coalesce(sum(o.net) filter (where o.booked), 0)::float8      as value
      from o
      join "user" u on u.id = o.user_id
      group by 1, 2
      order by 1
    `),
    // Client type (custom_fields.type) — on_trade / off_trade / …
    execRows<SliceSqlRow>(sql`
      ${base}
      select
        coalesce(nullif(c.custom_fields ->> 'type', ''), 'unknown')  as key,
        coalesce(nullif(c.custom_fields ->> 'type', ''), 'unknown')  as label,
        null::text                                                   as extra,
        coalesce(sum(o.net) filter (where o.booked), 0)::float8      as revenue,
        count(*) filter (where o.booked)::int                        as orders,
        coalesce(sum(oagg.units) filter (where o.booked), 0)::int    as units,
        count(distinct o.client_id) filter (where o.booked)::int     as clients
      from o
      join client c on c.id = o.client_id
      left join oagg on oagg.order_id = o.id
      group by 1, 2
      order by revenue desc
    `),
    execRows<{ period: string; stack: string; value: number }>(sql`
      ${base}
      select
        to_char(date_trunc('month', o.order_date), 'YYYY-MM')        as period,
        coalesce(nullif(c.custom_fields ->> 'type', ''), 'unknown')  as stack,
        coalesce(sum(o.net) filter (where o.booked), 0)::float8      as value
      from o
      join client c on c.id = o.client_id
      group by 1, 2
      order by 1
    `),
    execRows<SliceSqlRow>(sql`
      ${base}
      select
        c.id                                                         as key,
        c.name                                                       as label,
        coalesce(nullif(c.custom_fields ->> 'type', ''), 'unknown')  as extra,
        coalesce(sum(o.net) filter (where o.booked), 0)::float8      as revenue,
        count(*) filter (where o.booked)::int                        as orders,
        coalesce(sum(oagg.units) filter (where o.booked), 0)::int    as units,
        1::int                                                       as clients
      from o
      join client c on c.id = o.client_id
      left join oagg on oagg.order_id = o.id
      group by 1, 2, 3
      having count(*) filter (where o.booked) > 0
      order by revenue desc
      limit 12
    `),
    execRows<ClientScatterPoint>(sql`
      ${base}
      select
        c.id                                                         as id,
        c.name                                                       as name,
        coalesce(nullif(c.custom_fields ->> 'type', ''), 'unknown')  as type,
        count(*) filter (where o.booked)::int                        as orders,
        coalesce(sum(o.net) filter (where o.booked), 0)::float8      as revenue,
        case when count(*) filter (where o.booked) > 0
             then coalesce(sum(o.net) filter (where o.booked), 0)::float8
                  / count(*) filter (where o.booked)
             else 0 end                                              as "avgOrderValue"
      from o
      join client c on c.id = o.client_id
      group by 1, 2, 3
      having count(*) filter (where o.booked) > 0
      order by revenue desc
    `),
    execRows<StatusRow>(sql`
      ${base}
      select
        o.status                              as status,
        count(*)::int                         as orders,
        coalesce(sum(o.total), 0)::float8     as amount,
        coalesce(sum(o.net), 0)::float8       as "amountNet"
      from o
      group by 1
      order by orders desc
    `),
    execRows<{ period: string; stack: string; value: number }>(sql`
      ${base}
      select
        to_char(date_trunc('month', o.order_date), 'YYYY-MM')  as period,
        o.status                                                as stack,
        count(*)::float8                                        as value
      from o
      group by 1, 2
      order by 1
    `),
    // Order-size histogram over booked orders. Fixed ₽ bands (not quantiles) so
    // the buckets stay comparable as the date filter moves.
    execRows<{ bucket: string; orders: number; revenue: number }>(sql`
      ${base}
      select
        b.bucket                                as bucket,
        count(*)::int                           as orders,
        coalesce(sum(o.net), 0)::float8         as revenue
      from o
      cross join lateral (
        select case
          when o.net <   50000 then '1'
          when o.net <  100000 then '2'
          when o.net <  250000 then '3'
          when o.net <  500000 then '4'
          when o.net < 1000000 then '5'
          else                      '6'
        end as bucket
      ) b
      where o.booked
      group by 1
      order by 1
    `),
    execRows<ProductRow>(sql`
      ${base}
      select
        p.id                                             as id,
        p.name                                           as name,
        p.additional_metadata ->> 'country_name'         as country,
        p.additional_metadata ->> 'type'                 as type,
        coalesce(sum(li.net), 0)::float8                 as revenue,
        coalesce(sum(li.quantity), 0)::int               as units,
        count(distinct li.order_id)::int                 as orders
      from li
      join product p on p.id = li.product_id
      where li.booked
      group by 1, 2, 3, 4
      order by revenue desc
      limit 15
    `),
  ])

  // Product slices — one query per catalog attribute. The key is whitelisted
  // via PRODUCT_ATTRIBUTE_KEYS, so nothing user-supplied reaches `sql.raw`.
  const attributeSlices = await Promise.all(
    PRODUCT_ATTRIBUTE_KEYS.map(async (attr) => {
      const rows = await execRows<SliceSqlRow>(sql`
        ${base}
        select
          coalesce(nullif(p.additional_metadata ->> ${attr}, ''), 'Не указано') as key,
          coalesce(nullif(p.additional_metadata ->> ${attr}, ''), 'Не указано') as label,
          null::text                                       as extra,
          coalesce(sum(li.net), 0)::float8                 as revenue,
          count(distinct li.order_id)::int                 as orders,
          coalesce(sum(li.quantity), 0)::int               as units,
          count(distinct li.client_id)::int                as clients
        from li
        join product p on p.id = li.product_id
        where li.booked
        group by 1, 2
        order by revenue desc
      `)
      return [attr, rows.map(toSlice)] as const
    }),
  )

  const pivot = (
    rows: { period: string; stack: string; value: number }[],
  ): { points: StackPoint[]; keys: string[] } => {
    const periods = [...new Set(rows.map((r) => r.period))].sort()
    // Stack order follows total size, so the biggest slice sits at the bottom
    // of every column and the eye can track it across the axis.
    const totals = new Map<string, number>()
    for (const r of rows)
      totals.set(r.stack, (totals.get(r.stack) ?? 0) + r.value)
    const keys = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
    const byPeriod = new Map<string, StackPoint>(
      periods.map((p) => [
        p,
        { period: p, ...Object.fromEntries(keys.map((k) => [k, 0])) },
      ]),
    )
    for (const r of rows) {
      const point = byPeriod.get(r.period)
      if (point) point[r.stack] = r.value
    }
    return { points: periods.map((p) => byPeriod.get(p)!), keys }
  }

  const dept = pivot(departmentMonthlyRaw)
  const ctype = pivot(clientTypeMonthlyRaw)
  const statusPivot = pivot(statusMonthlyRaw)

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    previousRange: { from: prevFrom.toISOString(), to: prevTo.toISOString() },
    totals,
    previousTotals,
    timeseries: { daily, monthly, annual },
    sellers: sellersRaw.map(toSlice),
    departments: departmentsRaw.map(toSlice),
    departmentMonthly: dept.points,
    departmentKeys: dept.keys,
    clientTypes: clientTypesRaw.map(toSlice),
    clientTypeMonthly: ctype.points,
    clientTypeKeys: ctype.keys,
    topClients: topClientsRaw.map(toSlice),
    clientScatter,
    statuses,
    statusMonthly: statusPivot.points,
    orderValueBuckets,
    products: Object.fromEntries(attributeSlices) as Record<
      ProductAttributeKey,
      SliceRow[]
    >,
    topProducts,
  }
}

/**
 * Earliest + latest order date in the org, so the page can default its range to
 * the data that actually exists instead of an empty "current month".
 */
export async function computeAnalyticsBounds(organizationId: string): Promise<{
  first: string | null
  last: string | null
}> {
  const rows = await execRows<{ first: string | null; last: string | null }>(sql`
    select
      to_char(min(order_date), 'YYYY-MM-DD') as first,
      to_char(max(order_date), 'YYYY-MM-DD') as last
    from "order"
    where organization_id = ${organizationId}
  `)
  return { first: rows[0]?.first ?? null, last: rows[0]?.last ?? null }
}
