"use client"

import { useState } from "react"
import { ChartCard, NoData } from "./analytics-primitives"
import {
  PeriodBars,
  TrendArea,
  TrendLine,
  type MetricKey,
} from "./analytics-charts"
import { MetricToggle } from "./metric-toggle"
import {
  formatMoney,
  formatMoneyFull,
  formatNumber,
} from "@/lib/analytics-format"
import type { SalesAnalytics } from "@/server/analytics"

/** Annual → monthly → daily, plus the average-check trend underneath. */
export function TabTime({ data }: { data: SalesAnalytics }) {
  const [metric, setMetric] = useState<MetricKey>("revenue")
  const { annual, monthly, daily } = data.timeseries

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <MetricToggle value={metric} onChange={setMetric} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="По годам"
          description="Годовые итоги за выбранный диапазон"
        >
          {annual.length ? (
            <PeriodBars data={annual} metric={metric} height={260} long />
          ) : (
            <NoData />
          )}
        </ChartCard>

        <ChartCard
          title="По месяцам"
          description="Помесячная динамика"
          className="lg:col-span-2"
        >
          {monthly.length ? (
            <PeriodBars data={monthly} metric={metric} height={260} />
          ) : (
            <NoData />
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="По дням"
        description="Ежедневная динамика — видно недельный ритм заказов"
      >
        {daily.length ? (
          <TrendArea data={daily} metric={metric} height={300} />
        ) : (
          <NoData />
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Средний чек по месяцам"
          description="Выручка, делённая на число оформленных заказов"
        >
          {monthly.length ? (
            <TrendLine
              data={monthly}
              dataKey="avgOrderValue"
              label="Средний чек"
              format={formatMoney}
              formatFull={formatMoneyFull}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>

        <ChartCard
          title="Активные клиенты по месяцам"
          description="Клиенты, оформившие хотя бы один заказ в месяце"
        >
          {monthly.length ? (
            <TrendLine
              data={monthly}
              dataKey="clients"
              label="Клиенты"
              format={formatNumber}
              formatFull={formatNumber}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>
      </div>
    </div>
  )
}
