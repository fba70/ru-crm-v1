// Риск «давно не было контакта» — прокси из client.updatedAt (та же дешёвая
// эвристика, что staleDaysFrom в src/server/deals-mock.ts для сделок).
// TODO(backend): считать по реальной последней активности (задачи/письма/
// звонки/встречи), не по дате последнего изменения записи.

export function clientStaleDays(updatedAtIso: string): number {
  const then = new Date(updatedAtIso).getTime()
  if (!Number.isFinite(then)) return 0
  const days = Math.floor((Date.now() - then) / 86_400_000)
  return days < 0 ? 0 : days
}

// ~2 месяца без активности — порог из обсуждения на звонке команды.
export const CLIENT_STALE_THRESHOLD_DAYS = 60

export function clientAtRisk(updatedAtIso: string): boolean {
  return clientStaleDays(updatedAtIso) > CLIENT_STALE_THRESHOLD_DAYS
}

// Склонение «заказ/заказа/заказов» (то же правило, что pluralizeDeals в
// src/lib/deal-board.ts, отдельная копия — разные слова).
export function pluralizeOrders(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return "заказов"
  if (mod10 === 1) return "заказ"
  if (mod10 >= 2 && mod10 <= 4) return "заказа"
  return "заказов"
}
