"use client"

import { useMemo, useState } from "react"
import { ChartCard, NoData, SliceTable } from "./analytics-primitives"
import {
  RankedBars,
  ShareDonut,
  StackedPeriodBars,
  buildSeries,
  remapStack,
  type MetricKey,
} from "./analytics-charts"
import { MetricToggle } from "./metric-toggle"
import { formatMoney, formatMoneyFull } from "@/lib/analytics-format"
import type { SalesAnalytics } from "@/server/analytics"

/** Salespeople and the departments they roll up into. */
export function TabSellers({ data }: { data: SalesAnalytics }) {
  const [metric, setMetric] = useState<MetricKey>("revenue")

  // One series set for BOTH department views, so a department keeps the same
  // hue in the stack, the radial and the table.
  const deptSeries = useMemo(
    () => buildSeries(data.departmentKeys),
    [data.departmentKeys],
  )
  const deptStack = useMemo(
    () => remapStack(data.departmentMonthly, deptSeries),
    [data.departmentMonthly, deptSeries],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <MetricToggle value={metric} onChange={setMetric} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Рейтинг сотрудников"
          description="Все продавцы за период, по убыванию"
          className="lg:col-span-2"
        >
          {data.sellers.length ? (
            <RankedBars rows={data.sellers} metric={metric} limit={15} />
          ) : (
            <NoData />
          )}
        </ChartCard>

        <ChartCard
          title="Доля отделов"
          description="Вклад каждого отдела за период"
        >
          {data.departments.length ? (
            <ShareDonut
              rows={data.departments}
              series={deptSeries}
              metric={metric}
              height={280}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Выручка по отделам и месяцам"
        description="Накопительная структура — видно, какой отдел двигает месяц"
      >
        {deptStack.length ? (
          <StackedPeriodBars
            data={deptStack}
            keys={deptSeries.keys}
            config={deptSeries.config}
            metricFormat={formatMoney}
            metricFormatFull={formatMoneyFull}
            height={300}
          />
        ) : (
          <NoData />
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Отделы" description="Сводка по отделам">
          <SliceTable
            rows={data.departments}
            labelHeader="Отдел"
            series={deptSeries}
          />
        </ChartCard>

        <ChartCard title="Сотрудники" description="Детализация по продавцам">
          <SliceTable rows={data.sellers} labelHeader="Сотрудник" limit={15} />
        </ChartCard>
      </div>
    </div>
  )
}
