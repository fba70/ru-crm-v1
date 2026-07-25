"use client"

// Shared building blocks for the «Аналитика» page: stat tiles, the chart card
// shell, and the table view that every tab pairs with its charts.
//
// The table view is not decoration — three of the palette's hues sit below 3:1
// contrast on the light surface, and the data-viz rules make "relief" mandatory
// in that case: the same numbers must be readable without relying on the mark's
// color. That's what `<SliceTable>` is for.

import { useId, type ReactNode } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartStyle } from "@/components/ui/chart"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  delta,
  formatMoneyFull,
  formatNumber,
  formatPercent,
} from "@/lib/analytics-format"
import type { SliceRow } from "@/server/analytics"
import type { Series } from "./analytics-charts"

// ── Stat tile ────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  hint,
  current,
  previous,
  invertDelta = false,
}: {
  label: string
  value: string
  hint?: string
  /** Supply both to render a period-over-period delta chip. */
  current?: number
  previous?: number
  /** When true, a decrease is the good outcome (e.g. discount give-away). */
  invertDelta?: boolean
}) {
  const change =
    current !== undefined && previous !== undefined
      ? delta(current, previous)
      : null
  const good = change === null ? null : invertDelta ? change < 0 : change > 0

  return (
    <Card className="gap-0 py-4">
      <CardHeader className="px-4 pb-1">
        <CardDescription className="text-xs">{label}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs">
          {change !== null ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium tabular-nums",
                good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
              )}
            >
              {change > 0 ? (
                <ArrowUp className="size-3" />
              ) : change < 0 ? (
                <ArrowDown className="size-3" />
              ) : (
                <Minus className="size-3" />
              )}
              {formatPercent(Math.abs(change), 1)}
            </span>
          ) : null}
          <span className="text-muted-foreground">
            {hint ?? (change !== null ? "к пред. периоду" : "")}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Chart card ───────────────────────────────────────────────────────

export function ChartCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={cn("gap-3 overflow-hidden", className)}>
      <CardHeader className="gap-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            {description ? (
              <CardDescription className="text-xs">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-2 sm:px-4 sm:pb-4">{children}</CardContent>
    </Card>
  )
}

// ── Table view ───────────────────────────────────────────────────────

/**
 * The tabular twin of a slice chart — same rows, same order, exact numbers.
 *
 * Pass `series` to carry the chart's colors into the table. The palette lives
 * in CSS variables that `ChartContainer` normally scopes to a chart, so the
 * table renders its own `<ChartStyle>` under a `data-chart` scope; without it
 * `var(--color-s0)` would resolve to nothing out here.
 */
export function SliceTable({
  rows,
  labelHeader,
  limit = 10,
  metric = "revenue",
  series,
}: {
  rows: SliceRow[]
  labelHeader: string
  limit?: number
  metric?: "revenue" | "units" | "orders"
  series?: Series
}) {
  const scopeId = useId().replace(/:/g, "")
  const shown = rows.slice(0, limit)
  const total = rows.reduce((s, r) => s + (r[metric] ?? 0), 0)

  return (
    <div className="overflow-x-auto" data-chart={scopeId}>
      {series ? <ChartStyle id={scopeId} config={series.config} /> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{labelHeader}</TableHead>
            <TableHead className="text-right text-xs">Выручка</TableHead>
            <TableHead className="text-right text-xs">Заказы</TableHead>
            <TableHead className="text-right text-xs">Единиц</TableHead>
            <TableHead className="text-right text-xs">Доля</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => {
            const share = total > 0 ? (r[metric] ?? 0) / total : 0
            return (
              <TableRow key={r.key}>
                <TableCell className="max-w-88 truncate text-xs font-medium">
                  <span className="flex items-center gap-2">
                    {series ? (
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-xs"
                        style={{ background: series.colorOf(r.label) }}
                      />
                    ) : null}
                    <span className="truncate">{r.label}</span>
                    {r.extra && r.extra !== "—" ? (
                      <span className="text-muted-foreground font-normal">
                        · {r.extra}
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {formatMoneyFull(r.revenue)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {formatNumber(r.orders)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {formatNumber(r.units)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {formatPercent(share, 1)}
                </TableCell>
              </TableRow>
            )
          })}
          {shown.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-muted-foreground py-6 text-center text-xs"
              >
                Нет данных за выбранный период
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}

/** Empty-state used when a whole tab has nothing to draw. */
export function NoData({ label = "Нет данных за выбранный период" }) {
  return (
    <div className="text-muted-foreground flex h-55 items-center justify-center text-xs">
      {label}
    </div>
  )
}
