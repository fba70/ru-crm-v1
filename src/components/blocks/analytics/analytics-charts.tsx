"use client"

// Chart vocabulary for the «Аналитика» page.
//
// House rules encoded here once so every tab inherits them:
//   • one y-axis, never two (a dual-scale plot invents correlations)
//   • solid hairline grid, no dashes, no axis lines — chrome stays recessive
//   • thin marks with 4px rounded data-ends; stacked segments are separated by
//     a 1.5px stroke in the surface color so adjacent fills never touch
//   • a legend whenever ≥2 series are drawn; direct value labels on ranked bars
//     and donut slices (mandatory relief — several palette hues sit under 3:1
//     contrast on the light surface)
//   • color is keyed to the ENTITY, in fixed slot order — filtering a series
//     never repaints the survivors, and hues are never cycled past 8
//
// See src/lib/analytics-format.ts for the palette and its validation record.

import type { ReactNode } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  MUTED_SERIES,
  OTHER_LABEL,
  STATUS_COLORS,
  STATUS_ORDER,
  UNSPECIFIED,
  formatMoney,
  formatMoneyFull,
  formatNumber,
  formatPercent,
  formatPeriod,
  seriesColor,
} from "@/lib/analytics-format"
import { ORDER_STATUS_LABEL } from "@/lib/orders-format"
import type { OrderStatus } from "@/db/schema"
import type {
  ClientScatterPoint,
  SliceRow,
  StackPoint,
  TimePoint,
} from "@/server/analytics"

/** Mirrors recharts' `RenderableText` — what a `<LabelList>` formatter receives. */
type LabelValue = string | number | boolean | null | undefined

const GRID = "var(--border)"
const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" }
/** Stacked/adjacent fills are separated by a hairline in the surface color. */
const SEGMENT_GAP = { stroke: "var(--card)", strokeWidth: 1.5 }

export type MetricKey = "revenue" | "orders" | "units"

export const METRIC_LABEL: Record<MetricKey, string> = {
  revenue: "Выручка",
  orders: "Заказы",
  units: "Единиц продано",
}

export const metricFormatter = (metric: MetricKey) =>
  metric === "revenue" ? formatMoney : formatNumber

export const metricFormatterFull = (metric: MetricKey) =>
  metric === "revenue" ? formatMoneyFull : formatNumber

/**
 * Tooltip row renderer. shadcn's `ChartTooltipContent` hands the whole row to a
 * custom `formatter`, so this rebuilds the swatch + label + value itself rather
 * than losing the indicator.
 */
function rowFormatter(fmt: (n: number) => string, config: ChartConfig) {
  return ((value, name, item) => (
    <>
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-xs"
        style={{
          background:
            (item as { color?: string })?.color ??
            (item as { payload?: { fill?: string } })?.payload?.fill,
        }}
      />
      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
        <span className="text-muted-foreground">
          {config[String(name)]?.label ?? String(name)}
        </span>
        <span className="text-foreground font-mono font-medium tabular-nums">
          {fmt(Number(value))}
        </span>
      </div>
    </>
  )) as React.ComponentProps<typeof ChartTooltipContent>["formatter"]
}

/**
 * A resolved set of categorical series.
 *
 * Real-world labels («Отдел 1», «СОЕДИНЕННОЕ КОРОЛЕВСТВО») can't be used as CSS
 * custom-property names — a space makes `--color-Отдел 1` invalid and the mark
 * silently loses its fill. So every series gets a synthetic key (`s0`, `s1`, …)
 * that names the CSS variable, while the human label lives in the chart config
 * and is what tooltips and legends actually print.
 *
 * Slots are handed out in the label order the caller passes (which is sorted by
 * size), and that mapping is stable for the life of the payload — color follows
 * the entity, never its position in a filtered subset.
 */
export type Series = {
  keys: string[]
  labels: string[]
  config: ChartConfig
  keyOf: (label: string) => string
  colorOf: (label: string) => string
}

export function buildSeries(labels: string[]): Series {
  const keys = labels.map((_, i) => `s${i}`)
  const byLabel = new Map(labels.map((l, i) => [l, keys[i]]))
  const config = Object.fromEntries(
    labels.map((label, i) => [
      keys[i],
      {
        label,
        // The folded tail and the "no value" bucket are deliberately neutral —
        // they aren't entities, so they don't earn a hue.
        theme:
          label === OTHER_LABEL || label === UNSPECIFIED || label === "Без типа"
            ? MUTED_SERIES
            : { light: seriesColor(i).light, dark: seriesColor(i).dark },
      },
    ]),
  ) as ChartConfig

  return {
    keys,
    labels,
    config,
    keyOf: (label) => byLabel.get(label) ?? label,
    colorOf: (label) => `var(--color-${byLabel.get(label) ?? label})`,
  }
}

/** Rewrite pivoted stack points from human labels to the series' safe keys. */
export function remapStack(points: StackPoint[], series: Series): StackPoint[] {
  return points.map((p) => {
    const out: StackPoint = { period: String(p.period) }
    for (const label of series.labels) out[series.keyOf(label)] = Number(p[label] ?? 0)
    return out
  })
}

// ── Time ─────────────────────────────────────────────────────────────

/** Single-series trend. One measure, one hue, gradient fill under the line. */
export function TrendArea({
  data,
  metric = "revenue",
  height = 260,
}: {
  data: TimePoint[]
  metric?: MetricKey
  height?: number
}) {
  const config = {
    [metric]: {
      label: METRIC_LABEL[metric],
      theme: { light: seriesColor(0).light, dark: seriesColor(0).dark },
    },
  } satisfies ChartConfig
  const fmt = metricFormatter(metric)

  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--color-${metric})`} stopOpacity={0.28} />
            <stop offset="100%" stopColor={`var(--color-${metric})`} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="period"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tick={AXIS_TICK}
          tickFormatter={(v: string) => formatPeriod(v)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={78}
          tick={AXIS_TICK}
          tickFormatter={(v: number) => fmt(v)}
        />
        <ChartTooltip
          cursor={{ stroke: GRID, strokeWidth: 1 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) =>
                formatPeriod(String(p?.[0]?.payload?.period ?? ""), true)
              }
              formatter={rowFormatter(metricFormatterFull(metric), config)}
            />
          }
        />
        <Area
          dataKey={metric}
          type="monotone"
          stroke={`var(--color-${metric})`}
          strokeWidth={2}
          fill={`url(#fill-${metric})`}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}

/** Columns over a time axis — the discrete-period counterpart of TrendArea. */
export function PeriodBars({
  data,
  metric = "revenue",
  height = 260,
  long = false,
}: {
  data: TimePoint[]
  metric?: MetricKey
  height?: number
  /** Spell the year out on the axis (used by the annual view). */
  long?: boolean
}) {
  const config = {
    [metric]: {
      label: METRIC_LABEL[metric],
      theme: { light: seriesColor(0).light, dark: seriesColor(0).dark },
    },
  } satisfies ChartConfig
  const fmt = metricFormatter(metric)

  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="period"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={AXIS_TICK}
          tickFormatter={(v: string) => formatPeriod(v, long)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={78}
          tick={AXIS_TICK}
          tickFormatter={(v: number) => fmt(v)}
        />
        <ChartTooltip
          cursor={{ fill: GRID, fillOpacity: 0.35 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) =>
                formatPeriod(String(p?.[0]?.payload?.period ?? ""), true)
              }
              formatter={rowFormatter(metricFormatterFull(metric), config)}
            />
          }
        />
        <Bar
          dataKey={metric}
          fill={`var(--color-${metric})`}
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
        />
      </BarChart>
    </ChartContainer>
  )
}

/** Trend line for a rate/average — no fill, so it never reads as a volume. */
export function TrendLine({
  data,
  dataKey,
  label,
  format = formatMoney,
  formatFull = formatMoneyFull,
  height = 240,
}: {
  data: TimePoint[]
  dataKey: string
  label: string
  format?: (n: number) => string
  formatFull?: (n: number) => string
  height?: number
}) {
  const config = {
    [dataKey]: {
      label,
      theme: { light: seriesColor(1).light, dark: seriesColor(1).dark },
    },
  } satisfies ChartConfig

  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <LineChart accessibilityLayer data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="period"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tick={AXIS_TICK}
          tickFormatter={(v: string) => formatPeriod(v)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={78}
          tick={AXIS_TICK}
          tickFormatter={format}
        />
        <ChartTooltip
          cursor={{ stroke: GRID, strokeWidth: 1 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) =>
                formatPeriod(String(p?.[0]?.payload?.period ?? ""), true)
              }
              formatter={rowFormatter(formatFull, config)}
            />
          }
        />
        <Line
          dataKey={dataKey}
          type="monotone"
          stroke={`var(--color-${dataKey})`}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </LineChart>
    </ChartContainer>
  )
}

// ── Rankings ─────────────────────────────────────────────────────────

/**
 * Ranked horizontal bars — the workhorse for "compare magnitude across named
 * things". One series → ONE hue for every bar (a value-ramp here would just
 * double-encode bar length). Values are direct-labeled at the bar end.
 */
export function RankedBars({
  rows,
  metric = "revenue",
  limit = 10,
  height,
  colorByKey,
}: {
  rows: SliceRow[]
  metric?: MetricKey
  limit?: number
  height?: number
  /** Optional entity→CSS color map, when the bars must match another chart. */
  colorByKey?: Record<string, string>
}) {
  const data = rows.slice(0, limit)
  const config = {
    [metric]: {
      label: METRIC_LABEL[metric],
      theme: { light: seriesColor(0).light, dark: seriesColor(0).dark },
    },
  } satisfies ChartConfig
  const fmt = metricFormatter(metric)
  const fmtFull = metricFormatterFull(metric)
  const h = height ?? Math.max(200, data.length * 34 + 24)

  return (
    <ChartContainer config={config} style={{ height: h }} className="w-full">
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ left: 4, right: 88, top: 4, bottom: 4 }}
      >
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" dataKey={metric} hide />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={140}
          tick={AXIS_TICK}
          tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)}
        />
        <ChartTooltip
          cursor={{ fill: GRID, fillOpacity: 0.35 }}
          content={<ChartTooltipContent formatter={rowFormatter(fmtFull, config)} />}
        />
        <Bar dataKey={metric} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {colorByKey
            ? data.map((r) => (
                <Cell key={r.key} fill={colorByKey[r.label] ?? `var(--color-${metric})`} />
              ))
            : data.map((r) => <Cell key={r.key} fill={`var(--color-${metric})`} />)}
          <LabelList
            dataKey={metric}
            position="right"
            offset={8}
            className="fill-muted-foreground"
            fontSize={11}
            formatter={(v: LabelValue) => fmt(Number(v))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// ── Composition ──────────────────────────────────────────────────────

/** Stacked columns over time. `percent` switches to a 100% share view. */
export function StackedPeriodBars({
  data,
  keys,
  config,
  percent = false,
  metricFormat = formatMoney,
  metricFormatFull = formatMoneyFull,
  height = 280,
}: {
  /** Already remapped to `keys` — see `remapStack`. */
  data: StackPoint[]
  keys: string[]
  config: ChartConfig
  percent?: boolean
  metricFormat?: (n: number) => string
  metricFormatFull?: (n: number) => string
  height?: number
}) {
  // For a 100% view the shares are computed here rather than by the chart, so
  // the tooltip can show the true value alongside the normalised bar.
  const rows = percent
    ? data.map((d) => {
        const total = keys.reduce((s, k) => s + Number(d[k] ?? 0), 0)
        return {
          ...Object.fromEntries(
            keys.map((k) => [k, total > 0 ? Number(d[k] ?? 0) / total : 0]),
          ),
          period: d.period,
        } as StackPoint
      })
    : data

  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <BarChart accessibilityLayer data={rows} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="period"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={AXIS_TICK}
          tickFormatter={(v: string) => formatPeriod(v)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={percent ? 44 : 78}
          tick={AXIS_TICK}
          tickFormatter={(v: number) =>
            percent ? formatPercent(v, 0) : metricFormat(v)
          }
        />
        <ChartTooltip
          cursor={{ fill: GRID, fillOpacity: 0.35 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) =>
                formatPeriod(String(p?.[0]?.payload?.period ?? ""), true)
              }
              formatter={rowFormatter(
                percent ? (n) => formatPercent(n, 1) : metricFormatFull,
                config,
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
        {keys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            stackId="a"
            fill={`var(--color-${k})`}
            {...SEGMENT_GAP}
            radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={48}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

/** Stacked areas over time — for 2–4 series where the shape matters. */
export function StackedTrend({
  data,
  keys,
  config,
  height = 280,
}: {
  data: StackPoint[]
  keys: string[]
  config: ChartConfig
  height?: number
}) {
  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="period"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={AXIS_TICK}
          tickFormatter={(v: string) => formatPeriod(v)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={78}
          tick={AXIS_TICK}
          tickFormatter={formatMoney}
        />
        <ChartTooltip
          cursor={{ stroke: GRID, strokeWidth: 1 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) =>
                formatPeriod(String(p?.[0]?.payload?.period ?? ""), true)
              }
              formatter={rowFormatter(formatMoneyFull, config)}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
        {keys.map((k) => (
          <Area
            key={k}
            dataKey={k}
            type="monotone"
            stackId="a"
            stroke={`var(--color-${k})`}
            strokeWidth={1.5}
            fill={`var(--color-${k})`}
            fillOpacity={0.32}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  )
}

/**
 * Part-to-whole donut. Hard-capped at 6 slices by the caller — past that a
 * ranked bar reads better and this becomes unreadable.
 */
export function ShareDonut({
  rows,
  series,
  metric = "revenue",
  height = 260,
}: {
  rows: { label: string; revenue: number; orders: number; units: number }[]
  series: Series
  metric?: MetricKey
  height?: number
}) {
  const config = series.config
  const total = rows.reduce((s, r) => s + r[metric], 0)
  const data = rows.map((r) => ({
    name: series.keyOf(r.label),
    value: r[metric],
    fill: series.colorOf(r.label),
  }))

  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <PieChart margin={{ top: 4, bottom: 4 }}>
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              nameKey="name"
              formatter={rowFormatter(metricFormatterFull(metric), config)}
            />
          }
        />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="52%"
          outerRadius="80%"
          paddingAngle={1.5}
          strokeWidth={1.5}
          stroke="var(--card)"
        >
          <LabelList
            dataKey="value"
            position="outside"
            offset={10}
            className="fill-muted-foreground"
            fontSize={11}
            formatter={(v: LabelValue) =>
              total > 0 && Number(v) / total >= 0.04
                ? formatPercent(Number(v) / total, 0)
                : ""
            }
          />
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="name" className="flex-wrap" />} />
      </PieChart>
    </ChartContainer>
  )
}

/**
 * Radial gauge for ONE ratio against its limit (0–100%).
 *
 * Deliberately not used for part-to-whole across categories: stacking several
 * categories as concentric rings makes arc length depend on radius, so the
 * outer group always looks bigger than an equal inner one. Comparing shares is
 * the donut's job; a gauge answers "how far along is this single number".
 */
export function RadialGauge({
  value,
  label,
  height = 260,
  slot = 0,
}: {
  /** 0…1. */
  value: number
  label: string
  height?: number
  slot?: number
}) {
  const pct = Math.max(0, Math.min(1, value))
  const config = {
    value: {
      label,
      theme: { light: seriesColor(slot).light, dark: seriesColor(slot).dark },
    },
  } satisfies ChartConfig

  // The readout is an HTML overlay rather than a recharts <Label> inside
  // <PolarRadiusAxis>: that composition renders nothing here, and plain HTML
  // also inherits the app's type scale instead of re-specifying it in SVG.
  return (
    <div className="relative w-full" style={{ height }}>
      <ChartContainer config={config} className="size-full">
        <RadialBarChart
          data={[{ name: "value", value: pct, fill: "var(--color-value)" }]}
          innerRadius="68%"
          outerRadius="98%"
          startAngle={90}
          endAngle={90 - 360 * pct}
        >
          <PolarAngleAxis type="number" domain={[0, 1]} tick={false} />
          <RadialBar dataKey="value" background cornerRadius={6} />
        </RadialBarChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums">
          {formatPercent(pct, 0)}
        </span>
        <span className="text-muted-foreground text-xs">{label}</span>
      </div>
    </div>
  )
}

// ── Orders ───────────────────────────────────────────────────────────

/** Order counts by lifecycle status, in funnel order, in the STATUS palette. */
export function StatusBars({
  rows,
  height = 240,
}: {
  rows: { status: string; orders: number; amountNet: number }[]
  height?: number
}) {
  const config = Object.fromEntries(
    STATUS_ORDER.map((s) => [
      s,
      { label: ORDER_STATUS_LABEL[s], theme: STATUS_COLORS[s] },
    ]),
  ) as ChartConfig
  const byStatus = new Map(rows.map((r) => [r.status, r]))
  const data = STATUS_ORDER.map((s) => ({
    status: s,
    label: ORDER_STATUS_LABEL[s],
    orders: byStatus.get(s)?.orders ?? 0,
    amountNet: byStatus.get(s)?.amountNet ?? 0,
    fill: `var(--color-${s})`,
  }))

  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ left: 4, right: 64, top: 4, bottom: 4 }}
      >
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" dataKey="orders" hide />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={128}
          tick={AXIS_TICK}
        />
        <ChartTooltip
          cursor={{ fill: GRID, fillOpacity: 0.35 }}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => (
                <>
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-xs"
                    style={{ background: (item as { payload?: { fill?: string } })?.payload?.fill }}
                  />
                  <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                    <span className="text-muted-foreground">
                      {(item as { payload?: { label?: string } })?.payload?.label}
                    </span>
                    <span className="text-foreground font-mono font-medium tabular-nums">
                      {formatNumber(Number(value))} шт ·{" "}
                      {formatMoneyFull(
                        (item as { payload?: { amountNet?: number } })?.payload
                          ?.amountNet ?? 0,
                      )}
                    </span>
                  </div>
                </>
              )}
            />
          }
        />
        <Bar dataKey="orders" radius={[0, 4, 4, 0]} maxBarSize={26}>
          <LabelList
            dataKey="orders"
            position="right"
            offset={8}
            className="fill-muted-foreground"
            fontSize={11}
            formatter={(v: LabelValue) => formatNumber(Number(v))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/** Monthly status composition, normalised to 100%. */
export function StatusShareOverTime({
  data,
  height = 280,
}: {
  data: StackPoint[]
  height?: number
}) {
  const config = Object.fromEntries(
    STATUS_ORDER.map((s) => [
      s,
      { label: ORDER_STATUS_LABEL[s], theme: STATUS_COLORS[s] },
    ]),
  ) as ChartConfig
  const keys = STATUS_ORDER.filter((s) =>
    data.some((d) => Number(d[s] ?? 0) > 0),
  ) as OrderStatus[]

  return (
    <StackedPeriodBars
      data={data}
      keys={keys}
      config={config}
      percent
      height={height}
    />
  )
}

/** Order-size histogram. Ordered bands → a single hue, not a categorical set. */
export function ValueHistogram({
  data,
  height = 240,
}: {
  data: { bucket: string; label: string; orders: number; revenue: number }[]
  height?: number
}) {
  const config = {
    orders: {
      label: "Заказы",
      theme: { light: seriesColor(0).light, dark: seriesColor(0).dark },
    },
  } satisfies ChartConfig

  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 8, top: 16 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={AXIS_TICK}
          interval={0}
        />
        <YAxis tickLine={false} axisLine={false} width={40} tick={AXIS_TICK} />
        <ChartTooltip
          cursor={{ fill: GRID, fillOpacity: 0.35 }}
          content={
            <ChartTooltipContent
              formatter={(value, _name, item) => (
                <>
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-xs"
                    style={{ background: "var(--color-orders)" }}
                  />
                  <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                    <span className="text-muted-foreground">Заказы</span>
                    <span className="text-foreground font-mono font-medium tabular-nums">
                      {formatNumber(Number(value))} ·{" "}
                      {formatMoney(
                        (item as { payload?: { revenue?: number } })?.payload
                          ?.revenue ?? 0,
                      )}
                    </span>
                  </div>
                </>
              )}
            />
          }
        />
        <Bar dataKey="orders" fill="var(--color-orders)" radius={[4, 4, 0, 0]} maxBarSize={64}>
          <LabelList
            dataKey="orders"
            position="top"
            offset={6}
            className="fill-muted-foreground"
            fontSize={11}
            formatter={(v: LabelValue) => formatNumber(Number(v))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// ── Clients ──────────────────────────────────────────────────────────

/**
 * Client portfolio: order count against booked revenue, one mark per client,
 * colored by client type. Scatter compares ALL pairs of hues at once, so this
 * is capped at the three slots that clear the all-pairs gates.
 */
export function ClientScatter({
  points,
  typeKeys,
  config,
  height = 320,
}: {
  points: ClientScatterPoint[]
  typeKeys: string[]
  config: ChartConfig
  height?: number
}) {
  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <ScatterChart accessibilityLayer margin={{ left: 4, right: 16, top: 12, bottom: 8 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis
          type="number"
          dataKey="orders"
          name="Заказы"
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          tickMargin={8}
        />
        <YAxis
          type="number"
          dataKey="revenue"
          name="Выручка"
          tickLine={false}
          axisLine={false}
          width={78}
          tick={AXIS_TICK}
          tickFormatter={formatMoney}
        />
        <ZAxis type="number" dataKey="avgOrderValue" range={[60, 380]} />
        <ChartTooltip
          cursor={{ stroke: GRID, strokeWidth: 1 }}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(_value, _name, item) => {
                const p = (item as { payload?: ClientScatterPoint })?.payload
                if (!p) return null
                return (
                  <div className="grid gap-1">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-muted-foreground flex justify-between gap-4">
                      <span>Заказы</span>
                      <span className="text-foreground font-mono tabular-nums">
                        {formatNumber(p.orders)}
                      </span>
                    </div>
                    <div className="text-muted-foreground flex justify-between gap-4">
                      <span>Выручка</span>
                      <span className="text-foreground font-mono tabular-nums">
                        {formatMoneyFull(p.revenue)}
                      </span>
                    </div>
                    <div className="text-muted-foreground flex justify-between gap-4">
                      <span>Средний чек</span>
                      <span className="text-foreground font-mono tabular-nums">
                        {formatMoneyFull(p.avgOrderValue)}
                      </span>
                    </div>
                  </div>
                )
              }}
            />
          }
        />
        {/* `nameKey="name"` — a Scatter's legend entry resolves its config
            through the series' `name` prop; the default (`dataKey`) would look
            up "revenue", which isn't a series, and the label would render
            empty. */}
        <ChartLegend content={<ChartLegendContent nameKey="name" className="flex-wrap" />} />
        {typeKeys.map((t) => (
          <Scatter
            key={t}
            name={t}
            dataKey="revenue"
            data={points.filter((p) => p.type === t)}
            fill={`var(--color-${t})`}
            fillOpacity={0.75}
            stroke="var(--card)"
            strokeWidth={1.5}
          />
        ))}
      </ScatterChart>
    </ChartContainer>
  )
}

/**
 * Config for series whose keys are ALREADY valid CSS ident fragments (enum
 * values like `off_trade` / `finalized`). Everything else must go through
 * `buildSeries`, which synthesises safe keys.
 */
export function buildSafeConfig(
  keys: string[],
  labeller: (k: string) => string = (k) => k,
): ChartConfig {
  return Object.fromEntries(
    keys.map((k, i) => [
      k,
      {
        label: labeller(k),
        theme:
          k === "unknown"
            ? MUTED_SERIES
            : { light: seriesColor(i).light, dark: seriesColor(i).dark },
      },
    ]),
  ) as ChartConfig
}

export function ChartFootnote({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground px-2 pt-2 text-[11px] leading-snug">
      {children}
    </p>
  )
}
