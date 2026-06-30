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
export const STAGE_COLOR: Record<string, string> = {
  Qualification: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  Discovery: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  Pilot: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  Proposal: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  Negotiations: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  Closed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  Rejected: "bg-red-500/15 text-red-600 dark:text-red-300",
}
export const STAGE_DEFAULT = "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"

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
