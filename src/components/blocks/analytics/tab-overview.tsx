"use client"

import {
  ChartCard,
  SliceTable,
  StatTile,
} from "./analytics-primitives"
import {
  RankedBars,
  ShareDonut,
  StatusBars,
  TrendArea,
  buildSeries,
} from "./analytics-charts"
import {
  clientTypeLabel,
  foldTail,
  formatMoney,
  formatMoneyFull,
  formatNumber,
  formatPercent,
} from "@/lib/analytics-format"
import type { SalesAnalytics } from "@/server/analytics"

/**
 * The landing view: a KPI row answering "how are we doing", then the four
 * charts that explain it — trend, funnel, who sells, what sells.
 * Every deeper cut lives on its own tab.
 */
export function TabOverview({ data }: { data: SalesAnalytics }) {
  const t = data.totals
  const p = data.previousTotals

  const clientTypeRows = foldTail(
    data.clientTypes.map((r) => ({ ...r, label: clientTypeLabel(r.key) })),
    6,
  )
  const clientTypeSeries = buildSeries(clientTypeRows.map((r) => r.label))

  const countries = data.products.country_name

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Выручка (оформлено)"
          value={formatMoney(t.revenue)}
          current={t.revenue}
          previous={p.revenue}
        />
        <StatTile
          label="Заказов оформлено"
          value={formatNumber(t.ordersBooked)}
          current={t.ordersBooked}
          previous={p.ordersBooked}
          hint={`из ${formatNumber(t.orders)} всего`}
        />
        <StatTile
          label="Средний чек"
          value={formatMoney(t.avgOrderValue)}
          current={t.avgOrderValue}
          previous={p.avgOrderValue}
        />
        <StatTile
          label="Клиентов с покупками"
          value={formatNumber(t.clients)}
          current={t.clients}
          previous={p.clients}
        />
        <StatTile
          label="Продано единиц"
          value={formatNumber(t.units)}
          current={t.units}
          previous={p.units}
        />
        <StatTile
          label="Товарных позиций"
          value={formatNumber(t.skus)}
          current={t.skus}
          previous={p.skus}
          hint="уникальных SKU"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Динамика выручки по месяцам"
          description={`Оформленные и подтверждённые заказы, за вычетом скидок · всего ${formatMoneyFull(t.revenue)}`}
          className="lg:col-span-2"
        >
          <TrendArea data={data.timeseries.monthly} metric="revenue" height={280} />
        </ChartCard>

        <ChartCard
          title="Заказы по статусам"
          description={`Доля оформленных — ${formatPercent(t.bookedRate, 0)}`}
        >
          <StatusBars rows={data.statuses} height={280} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Топ клиентов по выручке"
          description="10 крупнейших покупателей за период"
          className="lg:col-span-2"
        >
          <RankedBars rows={data.topClients} metric="revenue" limit={10} />
        </ChartCard>

        <ChartCard
          title="Структура продаж по типу клиента"
          description="On-trade / off-trade и прочие категории"
        >
          <ShareDonut rows={clientTypeRows} series={clientTypeSeries} height={280} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Продажи по странам происхождения"
          description="Топ-10 стран по выручке"
        >
          <RankedBars rows={countries} metric="revenue" limit={10} />
        </ChartCard>

        <ChartCard
          title="Продавцы"
          description="Выручка, заказы и объём по сотрудникам"
        >
          <SliceTable rows={data.sellers} labelHeader="Сотрудник" limit={10} />
        </ChartCard>
      </div>
    </div>
  )
}
