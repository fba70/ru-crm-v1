// МОК-сигналы по сделке (инсайты). Реальные должны приходить с бэка из
// анализа коммуникаций/активности. Детерминированы по id, чтобы не мигать.
// TODO(backend): заменить на реальные сигналы риска/инсайтов.

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

// Инсайт «риск проигрыша» — примерно у каждой 4-й сделки (мок).
export function mockAtRisk(id: string): boolean {
  return hashId("risk:" + id) % 4 === 0
}

const RISK_REASONS = [
  "Долго нет движения по сделке и ответа от клиента на последние сообщения.",
  "Клиент активно сравнивает с конкурентами и тянет с решением.",
  "Не закрыты ключевые возражения по цене и срокам внедрения.",
]

// Почему риск (мок-объяснение) — для поповера на карточке и плашки в drawer.
export function mockRiskReason(id: string): string {
  return RISK_REASONS[hashId("riskreason:" + id) % RISK_REASONS.length]
}
