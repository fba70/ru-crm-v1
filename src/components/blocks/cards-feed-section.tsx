"use client"

import { useMemo, useState } from "react"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Loader, X } from "lucide-react"
import type { CardRow } from "@/app/api/cards/route"
import { DashboardCard } from "@/components/blocks/dashboard-card"
import { useInfiniteScroll } from "@/lib/use-infinite-scroll"

// Two rows on the lg grid (3 cols) per scroll batch — was one row (3) behind
// click-through pagination; the team asked for roughly double, scroll-loaded
// instead of paged, but deliberately NOT as dense as a 12-per-screen option
// they considered and rejected.
const PAGE_SIZE = 6
export const ALL = "__all__"

export const PRIORITIES = ["normal", "high"] as const
export const CATEGORIES = [
  "client_activity",
  "colleagues_activity",
  "business_info",
  "action_required",
  "ambiguity",
  "data_intelligence",
  "momentum",
  "log_only",
  "new_order",
  "support",
] as const

export const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
  client_activity: "Активность клиента",
  colleagues_activity: "Активность коллег",
  business_info: "Бизнес-информация",
  action_required: "Требуется действие",
  ambiguity: "Неоднозначность",
  data_intelligence: "Аналитика данных",
  momentum: "Динамика",
  log_only: "Только запись",
  new_order: "Новый заказ",
  support: "Поддержка",
}

// UI display labels for card priority (DB enum values stay English).
export const PRIORITY_LABEL: Record<(typeof PRIORITIES)[number], string> = {
  normal: "Обычный",
  high: "Высокий",
}

export function CardsFeedSection({
  cards,
  loading,
  loadError,
  onRetry,
  onChanged,
  priority,
  category,
  from,
  to,
  includeRejected,
  onClearFilters,
}: {
  cards: CardRow[]
  loading: boolean
  // Отличает «реально пусто» от «запрос не выполнился» (сеть/БД) — иначе
  // сбой рендерится как «карточек нет», что читается как потеря данных.
  loadError: boolean
  onRetry: () => void
  onChanged: () => void
  // Приоритет/категория/период/отклонённые — все фильтры теперь в шапке
  // страницы (по образцу /clients) — секция только фильтрует и рендерит по
  // уже переданным значениям, селекты/контролы сами живут в page.tsx.
  priority: string
  category: string
  from: string
  to: string
  includeRejected: boolean
  onClearFilters: () => void
}) {
  const filtered = useMemo(() => {
    const fromTs = from ? new Date(from).getTime() : null
    const toTs = to ? new Date(`${to}T23:59:59.999`).getTime() : null

    return cards.filter((c) => {
      // Hide rejected cards unless the toggle includes them. Accepted
      // cards always pass — they remain on the dashboard as a record of
      // approved actions.
      if (!includeRejected && !!c.rejectionReason) return false

      if (priority !== ALL && c.priority !== priority) return false
      if (category !== ALL && c.category !== category) return false

      const created = new Date(c.createdAt).getTime()
      if (fromTs !== null && created < fromTs) return false
      if (toTs !== null && created > toTs) return false

      return true
    })
  }, [cards, priority, category, from, to, includeRejected])

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  // Any filter change re-narrows the set — start the scroll batch over.
  // Adjust state during render (React's documented pattern) instead of an
  // effect that does nothing but a synchronous setState.
  const filterKey = `${priority}|${category}|${from}|${to}|${includeRejected}`
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setVisibleCount(PAGE_SIZE)
  }

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length
  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    loading: false,
    onLoadMore: () => setVisibleCount((n) => n + PAGE_SIZE),
  })

  const grid = useMemo(
    () =>
      visible.map((c) => (
        <DashboardCard key={c.id} card={c} onChanged={onChanged} />
      )),
    [visible, onChanged],
  )

  // The default date range is "Все время" (both empty); any deviation
  // counts as a filter.
  const isAllTimeRange = from === "" && to === ""

  const hasFilters =
    priority !== ALL ||
    category !== ALL ||
    !isAllTimeRange ||
    includeRejected

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <span className="text-xs text-muted-foreground">
          {visible.length} из {filtered.length} карточек
        </span>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            <X className="h-4 w-4 mr-1" />
            Сбросить фильтры
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="animate-spin h-6 w-6" />
          </div>
        ) : loadError && cards.length === 0 ? (
          <Card className="border-dashed border-destructive/40 bg-destructive/5">
            <CardHeader className="items-center text-center gap-3">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <CardTitle className="text-base font-normal text-muted-foreground">
                Не удалось загрузить карточки. Проверьте соединение и попробуйте ещё раз.
              </CardTitle>
              <Button size="sm" variant="outline" onClick={onRetry}>
                Повторить
              </Button>
            </CardHeader>
          </Card>
        ) : cards.length === 0 ? (
          <EmptyState label="Пока нет карточек." />
        ) : filtered.length === 0 ? (
          <EmptyState label="Нет карточек по заданным фильтрам." />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {grid}
            </div>
            {hasMore && (
              <div
                ref={sentinelRef}
                className="flex items-center justify-center py-6"
              >
                <Loader className="animate-spin h-5 w-5 text-muted-foreground" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <Card className="border-dashed bg-muted/50 dark:bg-muted/30 border-muted">
      <CardHeader>
        <CardTitle className="text-base text-muted-foreground font-normal text-center">
          {label}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}
