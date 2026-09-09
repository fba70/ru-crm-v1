"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Loader, X } from "lucide-react"
import type { CardRow } from "@/app/api/cards/route"
import { DashboardCard } from "@/components/blocks/dashboard-card"
import { useInfiniteScroll } from "@/lib/use-infinite-scroll"

// Two rows on the lg grid (3 cols) per scroll batch — was one row (3) behind
// click-through pagination; the team asked for roughly double, scroll-loaded
// instead of paged, but deliberately NOT as dense as a 12-per-screen option
// they considered and rejected.
const PAGE_SIZE = 6
export const ALL = "__all__"

function isoDateNDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

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
  onChanged,
  priority,
  onPriorityChange,
  category,
  onCategoryChange,
}: {
  cards: CardRow[]
  loading: boolean
  onChanged: () => void
  // Приоритет/категория: селекты теперь в шапке страницы (по образцу
  // /clients) — секция только фильтрует по уже переданным значениям.
  priority: string
  onPriorityChange: (v: string) => void
  category: string
  onCategoryChange: (v: string) => void
}) {
  // Default view is scoped to the last day; the "Все время" preset clears it.
  const [from, setFrom] = useState<string>(() => isoDateNDaysAgo(1))
  const [to, setTo] = useState<string>(() => todayIso())
  // Accepted cards stay visible (they're a record of approved actions).
  // This toggle only controls visibility of *rejected* cards, which are
  // hidden by default since they were dismissed.
  const [includeRejected, setIncludeRejected] = useState(false)

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

  // The default date range is the last day; any deviation counts as a filter.
  const isDefaultDateRange =
    from === isoDateNDaysAgo(1) && to === todayIso()

  const hasFilters =
    priority !== ALL ||
    category !== ALL ||
    !isDefaultDateRange ||
    includeRejected

  const clearFilters = () => {
    onPriorityChange(ALL)
    onCategoryChange(ALL)
    setFrom(isoDateNDaysAgo(1))
    setTo(todayIso())
    setIncludeRejected(false)
  }

  const rejectedCount = cards.filter((c) => !!c.rejectionReason).length

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="gap-3 shrink-0">
        <CardTitle className="text-xl tracking-wide">
          Утренние карточки
        </CardTitle>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label
              htmlFor="cards-from"
              className="text-xs text-muted-foreground"
            >
              С
            </Label>
            <Input
              id="cards-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-fit"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="cards-to" className="text-xs text-muted-foreground">
              По
            </Label>
            <Input
              id="cards-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-fit"
            />
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                setFrom(isoDateNDaysAgo(1))
                setTo(todayIso())
              }}
            >
              За день
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                setFrom(isoDateNDaysAgo(7))
                setTo(todayIso())
              }}
            >
              За неделю
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                setFrom("")
                setTo("")
              }}
            >
              Все время
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="cards-include-rejected"
              checked={includeRejected}
              onCheckedChange={(v) => setIncludeRejected(v === true)}
            />
            <Label
              htmlFor="cards-include-rejected"
              className="text-xs cursor-pointer"
            >
              Показать отклонённые ({rejectedCount})
            </Label>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {visible.length} из {filtered.length} карточек
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              disabled={!hasFilters}
            >
              <X className="h-4 w-4 mr-1" />
              Сбросить фильтры
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="animate-spin h-6 w-6" />
          </div>
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
      </CardContent>
    </Card>
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
