"use client"

import { useMemo } from "react"
import {
  ChartCard,
  NoData,
  StatTile,
} from "./analytics-primitives"
import {
  ChartFootnote,
  RadialGauge,
  StatusBars,
  StatusShareOverTime,
  TrendLine,
  ValueHistogram,
} from "./analytics-charts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  ORDER_VALUE_BUCKET_LABELS,
  formatMoney,
  formatMoneyFull,
  formatNumber,
  formatPercent,
} from "@/lib/analytics-format"
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from "@/lib/orders-format"
import type { OrderStatus } from "@/db/schema"
import type { SalesAnalytics } from "@/server/analytics"

/** The order book itself: lifecycle mix, deal sizes, average check. */
export function TabOrders({ data }: { data: SalesAnalytics }) {
  const t = data.totals
  const p = data.previousTotals

  const buckets = useMemo(
    () =>
      data.orderValueBuckets.map((b) => ({
        ...b,
        label: ORDER_VALUE_BUCKET_LABELS[b.bucket] ?? b.bucket,
      })),
    [data.orderValueBuckets],
  )

  const totalOrders = data.statuses.reduce((s, r) => s + r.orders, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Всего заказов"
          value={formatNumber(t.orders)}
          current={t.orders}
          previous={p.orders}
        />
        <StatTile
          label="Доля оформленных"
          value={formatPercent(t.bookedRate, 0)}
          current={t.bookedRate}
          previous={p.bookedRate}
        />
        <StatTile
          label="Средний чек"
          value={formatMoney(t.avgOrderValue)}
          current={t.avgOrderValue}
          previous={p.avgOrderValue}
        />
        <StatTile
          label="Скидки"
          value={formatMoney(t.discountAmount)}
          current={t.discountAmount}
          previous={p.discountAmount}
          invertDelta
          hint="от каталожной суммы"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Заказы по статусам"
          description="Порядок соответствует жизненному циклу заказа"
          className="lg:col-span-2"
        >
          <StatusBars rows={data.statuses} height={260} />
          <ChartFootnote>
            В выручку попадают только «Оформлен» и «Подтверждён» — остальные
            статусы это воронка, а не продажи.
          </ChartFootnote>
        </ChartCard>

        <ChartCard
          title="Конверсия в продажу"
          description="Доля заказов, дошедших до «Оформлен» или «Подтверждён»"
        >
          <RadialGauge
            value={t.bookedRate}
            label="оформлено"
            height={260}
            slot={2}
          />
        </ChartCard>
      </div>

      <ChartCard
        title="Структура статусов по месяцам"
        description="Доля каждого статуса внутри месяца, 100%"
      >
        {data.statusMonthly.length ? (
          <StatusShareOverTime data={data.statusMonthly} height={280} />
        ) : (
          <NoData />
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Распределение по сумме заказа"
          description="Сколько заказов попадает в каждый ценовой диапазон"
        >
          {buckets.length ? <ValueHistogram data={buckets} height={260} /> : <NoData />}
        </ChartCard>

        <ChartCard
          title="Средний чек по месяцам"
          description="Динамика размера сделки"
        >
          {data.timeseries.monthly.length ? (
            <TrendLine
              data={data.timeseries.monthly}
              dataKey="avgOrderValue"
              label="Средний чек"
              height={260}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Сводка по статусам"
        description="Каталожная сумма и сумма за вычетом скидок"
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Статус</TableHead>
                <TableHead className="text-right text-xs">Заказы</TableHead>
                <TableHead className="text-right text-xs">Доля</TableHead>
                <TableHead className="text-right text-xs">Сумма</TableHead>
                <TableHead className="text-right text-xs">
                  За вычетом скидок
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.statuses.map((r) => (
                <TableRow key={r.status}>
                  <TableCell className="text-xs">
                    <Badge
                      variant="secondary"
                      className={ORDER_STATUS_COLOR[r.status as OrderStatus]}
                    >
                      {ORDER_STATUS_LABEL[r.status as OrderStatus] ?? r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatNumber(r.orders)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatPercent(totalOrders ? r.orders / totalOrders : 0, 1)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatMoneyFull(r.amount)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatMoneyFull(r.amountNet)}
                  </TableCell>
                </TableRow>
              ))}
              {data.statuses.length === 0 ? (
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
      </ChartCard>
    </div>
  )
}
