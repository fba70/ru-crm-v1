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
// Шкала стадий — СПЛОШНЫЕ цвета одного семейства (голубой #669BBC),
// нарастающие к «Переговорам» (самый яркий = сам палитровый голубой).
// Прозрачности убраны сознательно: alpha-полутона поверх крем-фона светлой
// темы читались как РАЗНЫЕ оттенки, а не как возрастающая шкала.
// Квалификация — нейтральная; Закрыта/Проиграна — зелёная/красная
// (семантика исхода), тоже сплошные.
export const STAGE_COLOR: Record<string, string> = {
  Qualification:
    "bg-[#ECE9E0] text-[#5D6B76] dark:bg-[#1C3242] dark:text-[#A8BCC9]",
  Discovery:
    "bg-[#DEEAF1] text-[#2F5D77] dark:bg-[#16394E] dark:text-[#9FC4DC]",
  Pilot:
    "bg-[#BFD7E4] text-[#24506B] dark:bg-[#1E4A63] dark:text-[#B8D4E6]",
  Proposal:
    "bg-[#94BDD3] text-[#0F3247] dark:bg-[#2E617F] dark:text-[#DCEAF2]",
  // Светлая: фон углублён до #477899 ради светлого текста (белый = 4.76:1,
  // AA) — тёмный текст на среднем синем выглядел мутно. Тёмная: сам #669BBC
  // с ink-текстом (5.6:1).
  Negotiations:
    "bg-[#477899] text-white dark:bg-[#669BBC] dark:text-[#00212F]",
  Closed:
    "bg-[#D8EBDD] text-[#1F6B44] dark:bg-[#1D4230] dark:text-[#7FD0A3]",
  Rejected:
    "bg-[#F3D9DB] text-[#8E0E17] dark:bg-[#452028] dark:text-[#FF8F96]",
}
export const STAGE_DEFAULT =
  "bg-[#E9E7E2] text-[#5D6470] dark:bg-[#243845] dark:text-[#A8B6BF]"

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
