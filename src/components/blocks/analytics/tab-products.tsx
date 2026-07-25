"use client"

import { useMemo, useState } from "react"
import { ChartCard, NoData, SliceTable } from "./analytics-primitives"
import {
  ChartFootnote,
  RankedBars,
  ShareDonut,
  buildSeries,
  type MetricKey,
} from "./analytics-charts"
import { MetricToggle } from "./metric-toggle"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import {
  PRODUCT_ATTRIBUTE_KEYS,
  PRODUCT_ATTRIBUTE_LABELS,
  foldTail,
  formatMoneyFull,
  formatNumber,
  type ProductAttributeKey,
} from "@/lib/analytics-format"
import type { SalesAnalytics } from "@/server/analytics"

/**
 * What actually sold, cut by the catalog attributes: country of origin,
 * region, colour, type and sugar level.
 *
 * The ranked bars carry ALL values of the selected attribute (a single hue —
 * the bar length is the message), while the donut shows the top-6 composition.
 * Past six the tail folds into «Прочее» rather than inventing a seventh hue.
 */
export function TabProducts({ data }: { data: SalesAnalytics }) {
  const [metric, setMetric] = useState<MetricKey>("revenue")
  const [attribute, setAttribute] =
    useState<ProductAttributeKey>("country_name")

  const rows = useMemo(
    () => data.products[attribute] ?? [],
    [data.products, attribute],
  )

  const donutRows = useMemo(() => foldTail(rows, 6), [rows])
  const donutSeries = useMemo(
    () => buildSeries(donutRows.map((r) => r.label)),
    [donutRows],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={attribute}
          onValueChange={(v) => v && setAttribute(v as ProductAttributeKey)}
          className="h-7"
        >
          {PRODUCT_ATTRIBUTE_KEYS.map((k) => (
            <ToggleGroupItem key={k} value={k} className="px-2 text-[11px]">
              {PRODUCT_ATTRIBUTE_LABELS[k]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <MetricToggle value={metric} onChange={setMetric} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title={`Продажи: ${PRODUCT_ATTRIBUTE_LABELS[attribute].toLowerCase()}`}
          description="Топ-12 значений атрибута за период"
          className="lg:col-span-2"
        >
          {rows.length ? (
            <RankedBars rows={rows} metric={metric} limit={12} />
          ) : (
            <NoData />
          )}
        </ChartCard>

        <ChartCard
          title="Структура"
          description="Топ-5 и остальное одним сегментом"
        >
          {donutRows.length ? (
            <ShareDonut
              rows={donutRows}
              series={donutSeries}
              metric={metric}
              height={280}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={PRODUCT_ATTRIBUTE_LABELS[attribute]}
          description={`Всего значений: ${formatNumber(rows.length)}`}
        >
          <SliceTable
            rows={rows}
            labelHeader={PRODUCT_ATTRIBUTE_LABELS[attribute]}
            limit={12}
            metric={metric}
          />
          <ChartFootnote>
            «Не указано» — позиции, у которых атрибут не заполнен в карточке
            товара.
          </ChartFootnote>
        </ChartCard>

        <ChartCard
          title="Топ товаров"
          description="15 позиций с наибольшей выручкой"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Товар</TableHead>
                  <TableHead className="text-right text-xs">Выручка</TableHead>
                  <TableHead className="text-right text-xs">Единиц</TableHead>
                  <TableHead className="text-right text-xs">Заказы</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topProducts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-80 text-xs font-medium">
                      <div className="truncate">{p.name}</div>
                      <div className="text-muted-foreground truncate font-normal">
                        {[p.country, p.type].filter(Boolean).join(" · ")}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatMoneyFull(p.revenue)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(p.units)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(p.orders)}
                    </TableCell>
                  </TableRow>
                ))}
                {data.topProducts.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
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
    </div>
  )
}
