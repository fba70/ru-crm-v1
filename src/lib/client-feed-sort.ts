// Порядок ленты «Компании» — единственное определение обоих режимов.
// Client-safe: сортировка выполняется на странице над уже загруженным
// списком, чтобы переключение «Сначала новые / Сначала критичные» было
// мгновенным и анимировалось (без повторного запроса к серверу).
import { clientAtRisk } from "@/lib/client-mocks"

export type ClientFeedSort = "new" | "critical"

type SortableClient = { id: string; createdAt: string; updatedAt: string }

// "new" — по дате добавления, новые наверху.
// "critical" — эвристика (TODO(backend), как и clientAtRisk): больше
// просроченных задач → давно не было контакта → недавно изменённые.
export function sortClientFeed<T extends SortableClient>(
  rows: T[],
  sort: ClientFeedSort,
  overdueById: Record<string, { overdueCount: number } | undefined>,
): T[] {
  const out = [...rows]
  if (sort === "critical") {
    out.sort((a, b) => {
      const overdueA = overdueById[a.id]?.overdueCount ?? 0
      const overdueB = overdueById[b.id]?.overdueCount ?? 0
      if (overdueA !== overdueB) return overdueB - overdueA
      const staleA = clientAtRisk(a.updatedAt) ? 1 : 0
      const staleB = clientAtRisk(b.updatedAt) ? 1 : 0
      if (staleA !== staleB) return staleB - staleA
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  } else {
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  return out
}
