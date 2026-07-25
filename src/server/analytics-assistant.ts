import "server-only"

import { tool } from "ai"
import { z } from "zod"
import { runAnalyticsQuery } from "@/server/analytics-semantic"
import {
  CHART_HINTS,
  DIMENSIONS,
  DIMENSION_KEYS,
  MEASURES,
  MEASURE_KEYS,
  type AnalyticsQuerySpec,
  type DimensionKey,
  type MeasureKey,
} from "@/lib/analytics-semantic"

// ── The analytics assistant's brain ──────────────────────────────────
//
// The system prompt and the single tool live here (not in the route) so the
// route stays a thin session gate and the exact same definitions can be
// exercised offline.
//
// A DELIBERATELY NARROW agent: one tool, one semantic model, no source search,
// no file upload, no json-render. It answers questions about the order book by
// choosing a measure + breakdown from the whitelist in
// `src/lib/analytics-semantic.ts` — it never writes SQL and never sees a row.
//
// Rendering split (the product decision): the model writes the PROSE, the app
// renders the CHART. Aggregated rows travel from SQL straight to
// `<AnalyticsAnswerCard>`; they ride along in the tool result the model reads,
// but the model never re-types them into a spec — so a chart cannot disagree
// with the query that produced it.

const measureEnum = z.enum(MEASURE_KEYS as [MeasureKey, ...MeasureKey[]])
const dimensionEnum = z.enum(
  DIMENSION_KEYS as [DimensionKey, ...DimensionKey[]],
)

/** The vocabulary block is generated from the semantic model, so adding a
 *  measure/dimension there teaches the model about it with no prompt edit. */
export function buildAnalyticsSystemPrompt(range: { from: string; to: string }) {
  const measures = MEASURE_KEYS.map(
    (k) => `- \`${k}\` (${MEASURES[k].label}) — ${MEASURES[k].hint}`,
  ).join("\n")
  const dimensions = DIMENSION_KEYS.map(
    (k) => `- \`${k}\` (${DIMENSIONS[k].label}) — ${DIMENSIONS[k].hint}`,
  ).join("\n")
  const charts = Object.entries(CHART_HINTS)
    .map(([k, v]) => `- \`${k}\` — ${v}`)
    .join("\n")

  return `Ты — аналитик по продажам внутри CRM. Отвечаешь на вопросы руководителя о заказах компании, опираясь ТОЛЬКО на инструмент \`queryAnalytics\`.

Отвечай по-русски, кратко и по делу. Денежные суммы всегда пиши со знаком ₽ и с разделителями разрядов (например «21 043 631 ₽»); крупные суммы можно округлять («21,0 млн ₽»).

## Данные, к которым у тебя есть доступ

Период с данными: ${range.from} — ${range.to}. Если пользователь не указал период, не передавай \`from\`/\`to\` — будет взят весь период.

Показатели (measure):
${measures}

Разрезы (dimension / splitBy):
${dimensions}

Типы графиков (chart):
${charts}

## Как работать

1. Переведи вопрос в ОДИН вызов \`queryAnalytics\`. Несколько вызовов — только если вопрос действительно составной (например «сравни выручку и количество»).
2. Затем напиши короткий вывод: 1–3 предложения с САМЫМ ГЛАВНЫМ — лидер, отставший, тренд, доля. Называй конкретные числа из результата.
3. **Скаляр против разреза** — это главное решение:
   - Вопрос об ОДНОМ числе («какой средний чек?», «сколько всего заказов?») → вызывай БЕЗ \`dimension\`. Ответ будет только текстом, без графика. Назови число прямо в тексте.
   - Вопрос о СРАВНЕНИИ или ДИНАМИКЕ → обязательно укажи \`dimension\`. График построится автоматически.
4. График рисует приложение, а не ты. **Никогда не рисуй ASCII-графики, не перечисляй все строки таблицы и не повторяй весь список значений в тексте** — пользователь видит их на графике и в таблице под твоим ответом. Упомяни 2–3 ключевых значения, не больше.
5. Выбирай \`chart\` осознанно: динамика во времени → \`line\`; сравнение по названиям → \`bar\`; доли 2–6 категорий → \`donut\`; состав во времени → \`stackedBar\` вместе со \`splitBy\`.
6. По времени по умолчанию бери \`time.month\`. \`time.day\` — только если явно просят по дням.
7. Фильтры задавай через \`filters\`: например \`{dimension: "clientType", value: "on_trade"}\` или \`{dimension: "product.country", value: "ФРАНЦИЯ"}\`. Значение можно писать так, как его видит пользователь.

## Границы

- Выручка считается по ОФОРМЛЕННЫМ и ПОДТВЕРЖДЁННЫМ заказам и УЖЕ учитывает скидку клиента. Черновики, отменённые и ожидающие клиента в выручку не входят — они видны только в разрезе \`status\`.
- Если вопрос выходит за рамки списка выше (прибыль, себестоимость, маржа, склад, план, конкретный текст переписки) — прямо скажи, что таких данных в модели нет, и предложи ближайший вопрос, на который ты ответить можешь. НИЧЕГО НЕ ВЫДУМЫВАЙ.
- Если инструмент вернул пустой результат или предупреждение — скажи об этом честно.`
}


/** The one tool. `organizationId` is bound by the caller — never model input. */
export function buildAnalyticsTools(
  organizationId: string,
  bounds: { from: Date; to: Date },
) {
  return {
    queryAnalytics: tool({
      description:
        "Aggregate the organization's order book. Pick a measure, optionally a dimension to break it down by, an optional second dimension to split by, and filters. Returns aggregated rows (or a single scalar when no dimension is given) — the app renders the chart, you write the takeaway.",
      inputSchema: z.object({
        measure: measureEnum.describe("What to measure."),
        dimension: dimensionEnum
          .optional()
          .describe(
            "Break the measure down by this. OMIT for a single number (answered in prose, no chart).",
          ),
        splitBy: dimensionEnum
          .optional()
          .describe("Second breakdown → a stacked composition."),
        filters: z
          .array(
            z.object({
              dimension: dimensionEnum,
              value: z.string().describe("Value to keep, as a user would write it."),
            }),
          )
          .optional()
          .describe("Narrow the data before aggregating."),
        from: z.iso
          .date()
          .optional()
          .describe("Inclusive start (YYYY-MM-DD). Omit for all data."),
        to: z.iso
          .date()
          .optional()
          .describe("Exclusive end (YYYY-MM-DD). Omit for all data."),
        topN: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("How many rows to keep (non-time breakdowns)."),
        chart: z
          .enum(["bar", "line", "area", "donut", "stackedBar", "table"])
          .optional()
          .describe("Preferred chart form."),
      }),
      execute: async (spec) => {
        const r = await runAnalyticsQuery(
          organizationId,
          spec as AnalyticsQuerySpec,
          bounds,
        )
        // The model gets a COMPACT view — labels + values it might quote, never
        // more than it can reason over. The card renders `__render` in full from
        // the same tool part, so nothing is lost visually.
        return {
          measure: r.meta.measureLabel,
          dimension: r.meta.dimensionLabel,
          splitBy: r.meta.splitLabel,
          total: Math.round(r.meta.total),
          scalar: r.scalar === null ? null : Math.round(r.scalar),
          rowCount: r.meta.rowCount,
          truncated: r.meta.truncated,
          warnings: r.meta.warnings,
          chart: r.meta.chart,
          rows: r.rows.slice(0, 30).map((x) => ({
            label: x.label,
            ...(x.splitLabel ? { split: x.splitLabel } : {}),
            value: Math.round(x.value),
          })),
          __render: r,
        }
      },
    }),
  } as const
}
