import type { DealRow, DealFunnelStageOption } from "@/server/deals"

// Терминальные (закрывающие) системные стадии — в доске выносятся на отдельную
// полку, drop в них запрещён. Имена соответствуют английским именам стадий в БД.
export const TERMINAL_STAGE_NAMES = ["Closed", "Rejected"] as const

export function isTerminalStage(stageName: string): boolean {
  return (TERMINAL_STAGE_NAMES as readonly string[]).includes(stageName)
}

export const CURRENCY_SYMBOL: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  GBP: "£",
  CNY: "¥",
  JPY: "¥",
  CHF: "CHF ",
  CAD: "CA$",
  AUD: "A$",
}

// Цвета стадий — по английскому имени стадии. Кастомные стадии орги падают
// в нейтральный default. (Перенесено из deal-card.tsx, чтобы не дублировать.)
// Шкала стадий — «драгоценные тона»: сплошные НАСЫЩЕННЫЕ средние тона
// (пастель читалась «карандашным наброском»), прогрессия по hue к «горячему»:
// teal → синий → фиолет → жжёный оранжевый. Оранжевый вместо красного
// НАМЕРЕННО: красный #C1121F зарезервирован за primary-кнопками и не должен
// бороться с заголовком стадии за внимание. Одни и те же цвета в обеих
// темах, все пары текст/фон ≥4.5:1 (AA). Квалификация — насыщенный
// нейтральный, Закрыта/Проиграна — сочные зелёная/тёмно-красная.
export const STAGE_COLOR: Record<string, string> = {
  Qualification: "bg-[#5D7183] text-white",
  Discovery: "bg-[#0E7490] text-white",
  Pilot: "bg-[#2F6BBF] text-white",
  Proposal: "bg-[#6D49B8] text-white",
  Negotiations: "bg-[#C2410C] text-white",
  Closed: "bg-[#1F7A4D] text-white",
  // Графит вместо красного: «проиграна» — нейтральный факт, а не тревога;
  // красный семейства primary тут только спорил бы за внимание. В тёмной
  // теме тон чуть приподнят, иначе сливается с ink-фоном.
  Rejected: "bg-[#242424] text-[#E7E5E4] dark:bg-[#3B3B40] dark:text-[#D6D6DA]",
}
export const STAGE_DEFAULT = "bg-[#5D7183] text-white"

export function formatAmount(
  value: string | null,
  currency: string,
): string | null {
  if (value === null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const symbol = CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency} `
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${symbol}${formatted}`
}

// Числовое значение сделки для агрегатов (0, если пусто/некорректно).
export function dealAmount(value: string | null): number {
  if (value === null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Форматирование агрегата (прогноз, сумма колонки) — единая валюта ₽.
export function formatAggregate(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`
}

// Группировка сумм по валютам → строка вида "1 200 000 ₽ · 30 000 $".
export function aggregateByCurrency(
  entries: { amount: number; currency: string }[],
): string {
  const byCur = new Map<string, number>()
  for (const e of entries) {
    byCur.set(e.currency, (byCur.get(e.currency) ?? 0) + e.amount)
  }
  const parts = Array.from(byCur.entries())
    .filter(([, n]) => n !== 0)
    .map(([cur, n]) => {
      const symbol = (CURRENCY_SYMBOL[cur.toUpperCase()] ?? cur).trim()
      return `${Math.round(n).toLocaleString("ru-RU")} ${symbol}`
    })
  return parts.length ? parts.join(" · ") : "0 ₽"
}

// Взвешенный прогноз: Σ value × вероятность, по активным НЕтерминальным сделкам.
// closureProbability — доля 0..1.
export function weightedForecast(
  deals: DealRow[],
  stages: DealFunnelStageOption[],
): number {
  const probByStageId = new Map(stages.map((s) => [s.id, s.closureProbability]))
  let total = 0
  for (const d of deals) {
    if (d.status !== "active") continue
    if (isTerminalStage(d.funnelStageName)) continue
    const prob = probByStageId.get(d.funnelStageId) ?? d.funnelStageProbability
    total += dealAmount(d.value) * prob
  }
  return total
}

export type OwnerFilter = "all" | "mine"

export function filterByOwner(
  deals: DealRow[],
  filter: OwnerFilter,
  currentUserId: string,
): DealRow[] {
  if (filter === "all") return deals
  return deals.filter((d) => d.userId === currentUserId)
}

export type MoveDirection = "fwd" | "back"

// Направление перевода по sortOrder стадий. Равный/больший порядок — вперёд.
export function moveDirection(
  fromSortOrder: number,
  toSortOrder: number,
): MoveDirection {
  return toSortOrder >= fromSortOrder ? "fwd" : "back"
}
