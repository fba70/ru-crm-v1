"use client"

// Renders ONE `queryAnalytics` tool result.
//
// The division of labour: the model writes the takeaway, this renders the
// picture. Aggregated rows come straight from SQL — they are never re-typed by
// the model — so the chart cannot disagree with the query that produced it.
//
// Scalars deliberately render NOTHING here: a single number is a sentence, not
// a chart, and the model already states it in prose.

import { useMemo } from "react"
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
  XAxis,
  YAxis,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  formatMoney,
  formatMoneyFull,
  formatNumber,
  formatPercent,
  seriesColor,
} from "@/lib/analytics-format"
import { buildSeries } from "./analytics-charts"
import type { AnalyticsQueryResult } from "@/lib/analytics-semantic"
import { AlertTriangle } from "lucide-react"

const GRID = "var(--border)"
const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" }
const SEGMENT_GAP = { stroke: "var(--card)", strokeWidth: 1.5 }
type LabelValue = string | number | boolean | null | undefined

/** Rows shown in the table under the chart before it gets its own scroll. */
const TABLE_ROWS = 12

export function AnalyticsAnswerCard({
  result,
}: {
  result: AnalyticsQueryResult
}) {
  const { rows, meta } = result
  const money = meta.measureKind === "money"
  const fmt = money ? formatMoney : formatNumber
  const fmtFull = money ? formatMoneyFull : formatNumber

  // A scalar is prose, not a picture — the model states it in the answer.
  if (!rows.length) {
    return meta.warnings.length ? <Warnings warnings={meta.warnings} /> : null
  }

  const split = Boolean(meta.splitLabel)

  return (
    <div className="bg-card mt-2 w-full overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 pt-3">
        <div className="text-sm font-medium">
          {meta.measureLabel}
          {meta.dimensionLabel ? (
            <span className="text-muted-foreground font-normal">
              {" · "}
              {meta.dimensionLabel.toLowerCase()}
              {meta.splitLabel ? ` × ${meta.splitLabel.toLowerCase()}` : ""}
            </span>
          ) : null}
        </div>
        <div className="text-muted-foreground text-xs tabular-nums">
          Всего: {fmtFull(meta.total)}
        </div>
      </div>

      <div className="px-1 pt-2 sm:px-3">
        {split ? (
          <StackedAnswer result={result} fmt={fmt} fmtFull={fmtFull} />
        ) : meta.chart === "donut" ? (
          <DonutAnswer result={result} fmtFull={fmtFull} />
        ) : meta.chart === "line" || meta.chart === "area" ? (
          <TrendAnswer result={result} fmt={fmt} fmtFull={fmtFull} />
        ) : meta.chart === "table" ? null : (
          <RankedAnswer result={result} fmt={fmt} fmtFull={fmtFull} />
        )}
      </div>

      <AnswerTable result={result} fmtFull={fmtFull} />

      {meta.truncated ? (
        <p className="text-muted-foreground px-4 pb-3 text-[11px]">
          Показаны только первые {meta.rowCount} — остальные значения меньше.
        </p>
      ) : null}
      {meta.warnings.length ? <Warnings warnings={meta.warnings} inline /> : null}
    </div>
  )
}

function Warnings({
  warnings,
  inline,
}: {
  warnings: string[]
  inline?: boolean
}) {
  return (
    <div
      className={
        inline
          ? "text-muted-foreground flex items-start gap-1.5 px-4 pb-3 text-[11px]"
          : "text-muted-foreground mt-2 flex items-start gap-1.5 text-xs"
      }
    >
      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
      <span>{warnings.join(" ")}</span>
    </div>
  )
}

// ── Forms ────────────────────────────────────────────────────────────

function TrendAnswer({
  result,
  fmt,
  fmtFull,
}: {
  result: AnalyticsQueryResult
  fmt: (n: number) => string
  fmtFull: (n: number) => string
}) {
  const config = {
    value: {
      label: result.meta.measureLabel,
      theme: { light: seriesColor(0).light, dark: seriesColor(0).dark },
    },
  } satisfies ChartConfig
  const area = result.meta.chart === "area"
  const Chart = area ? AreaChart : LineChart

  return (
    <ChartContainer config={config} style={{ height: 240 }} className="w-full">
      <Chart accessibilityLayer data={result.rows} margin={{ left: 4, right: 12, top: 8 }}>
        <defs>
          <linearGradient id="answer-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={20}
          tick={AXIS_TICK}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={78}
          tick={AXIS_TICK}
          tickFormatter={fmt}
        />
        <ChartTooltip
          cursor={{ stroke: GRID, strokeWidth: 1 }}
          content={
            <ChartTooltipContent
              labelKey="label"
              formatter={(v) => (
                <ValueRow
                  color="var(--color-value)"
                  name={result.meta.measureLabel}
                  value={fmtFull(Number(v))}
                />
              )}
            />
          }
        />
        {area ? (
          <Area
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            fill="url(#answer-fill)"
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        ) : (
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        )}
      </Chart>
    </ChartContainer>
  )
}

function RankedAnswer({
  result,
  fmt,
  fmtFull,
}: {
  result: AnalyticsQueryResult
  fmt: (n: number) => string
  fmtFull: (n: number) => string
}) {
  const config = {
    value: {
      label: result.meta.measureLabel,
      theme: { light: seriesColor(0).light, dark: seriesColor(0).dark },
    },
  } satisfies ChartConfig
  const height = Math.max(180, result.rows.length * 30 + 24)

  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <BarChart
        accessibilityLayer
        data={result.rows}
        layout="vertical"
        margin={{ left: 4, right: 88, top: 4, bottom: 4 }}
      >
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" dataKey="value" hide />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={130}
          tick={AXIS_TICK}
          tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
        />
        <ChartTooltip
          cursor={{ fill: GRID, fillOpacity: 0.35 }}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(v, _n, item) => (
                <ValueRow
                  color="var(--color-value)"
                  name={
                    (item as { payload?: { label?: string } })?.payload?.label ??
                    ""
                  }
                  value={fmtFull(Number(v))}
                />
              )}
            />
          }
        />
        {/* One series → one hue for every bar: a value-ramp here would just
            re-encode the bar length. */}
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20}>
          {result.rows.map((r) => (
            <Cell key={r.key} fill="var(--color-value)" />
          ))}
          <LabelList
            dataKey="value"
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

function DonutAnswer({
  result,
  fmtFull,
}: {
  result: AnalyticsQueryResult
  fmtFull: (n: number) => string
}) {
  const series = useMemo(
    () => buildSeries(result.rows.map((r) => r.label)),
    [result.rows],
  )
  const total = result.meta.total
  const data = result.rows.map((r) => ({
    name: series.keyOf(r.label),
    value: r.value,
    fill: series.colorOf(r.label),
  }))

  return (
    <ChartContainer config={series.config} style={{ height: 240 }} className="w-full">
      <PieChart margin={{ top: 4, bottom: 4 }}>
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              nameKey="name"
              formatter={(v, name, item) => (
                <ValueRow
                  color={
                    (item as { payload?: { fill?: string } })?.payload?.fill ?? ""
                  }
                  name={String(series.config[String(name)]?.label ?? name)}
                  value={fmtFull(Number(v))}
                />
              )}
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
              total > 0 && Number(v) / total >= 0.05
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

function StackedAnswer({
  result,
  fmt,
  fmtFull,
}: {
  result: AnalyticsQueryResult
  fmt: (n: number) => string
  fmtFull: (n: number) => string
}) {
  // Pivot (dimension × split) pairs into one row per dimension value, with the
  // stack keys ordered by total size so the biggest band sits at the bottom.
  const { data, series } = useMemo(() => {
    const axis: string[] = []
    const totals = new Map<string, number>()
    for (const r of result.rows) {
      if (!axis.includes(r.label)) axis.push(r.label)
      const s = r.splitLabel ?? "—"
      totals.set(s, (totals.get(s) ?? 0) + r.value)
    }
    const stackLabels = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
    const built = buildSeries(stackLabels)
    const byAxis = new Map<string, Record<string, string | number>>(
      axis.map((a) => [
        a,
        { label: a, ...Object.fromEntries(built.keys.map((k) => [k, 0])) },
      ]),
    )
    for (const r of result.rows) {
      const row = byAxis.get(r.label)
      if (row) row[built.keyOf(r.splitLabel ?? "—")] = r.value
    }
    return { data: axis.map((a) => byAxis.get(a)!), series: built }
  }, [result.rows])

  return (
    <ChartContainer config={series.config} style={{ height: 280 }} className="w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={AXIS_TICK}
          tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={78}
          tick={AXIS_TICK}
          tickFormatter={fmt}
        />
        <ChartTooltip
          cursor={{ fill: GRID, fillOpacity: 0.35 }}
          content={
            <ChartTooltipContent
              formatter={(v, name, item) => (
                <ValueRow
                  color={(item as { color?: string })?.color ?? ""}
                  name={String(series.config[String(name)]?.label ?? name)}
                  value={fmtFull(Number(v))}
                />
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
        {series.keys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            stackId="a"
            fill={`var(--color-${k})`}
            {...SEGMENT_GAP}
            radius={i === series.keys.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={44}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

// ── The exact numbers ────────────────────────────────────────────────

function AnswerTable({
  result,
  fmtFull,
}: {
  result: AnalyticsQueryResult
  fmtFull: (n: number) => string
}) {
  const { rows, meta } = result
  const shown = rows.slice(0, TABLE_ROWS)
  const split = Boolean(meta.splitLabel)

  return (
    <div className="max-h-72 overflow-auto border-t">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{meta.dimensionLabel}</TableHead>
            {split ? (
              <TableHead className="text-xs">{meta.splitLabel}</TableHead>
            ) : null}
            <TableHead className="text-right text-xs">
              {meta.measureLabel}
            </TableHead>
            <TableHead className="text-right text-xs">Доля</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r, i) => (
            <TableRow key={`${r.key}-${r.splitKey ?? ""}-${i}`}>
              <TableCell className="max-w-64 truncate text-xs font-medium">
                {r.label}
              </TableCell>
              {split ? (
                <TableCell className="text-muted-foreground max-w-40 truncate text-xs">
                  {r.splitLabel}
                </TableCell>
              ) : null}
              <TableCell className="text-right text-xs tabular-nums">
                {fmtFull(r.value)}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {meta.total > 0 ? formatPercent(r.value / meta.total, 1) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > TABLE_ROWS ? (
        <p className="text-muted-foreground px-4 py-2 text-[11px]">
          … и ещё {rows.length - TABLE_ROWS} строк(и)
        </p>
      ) : null}
    </div>
  )
}

/** shadcn's tooltip hands the whole row to a custom formatter — rebuild it. */
function ValueRow({
  color,
  name,
  value,
}: {
  color: string
  name: string
  value: string
}) {
  return (
    <>
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-xs"
        style={{ background: color }}
      />
      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
        <span className="text-muted-foreground">{name}</span>
        <span className="text-foreground font-mono font-medium tabular-nums">
          {value}
        </span>
      </div>
    </>
  )
}
