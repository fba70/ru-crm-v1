"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Loader, Sparkles, X } from "lucide-react"
import type { CardRow } from "@/app/api/cards/route"
import { DashboardCard } from "@/components/blocks/dashboard-card"
import { ExploreSourcesDialog } from "@/components/blocks/explore-sources-dialog"
import { MagicCardsButton } from "@/components/blocks/magic-cards-button"

// One row on the lg grid (3 cols) — pagination engages at 4+ visible cards.
const PAGE_SIZE = 3
const ALL = "__all__"

function isoDateNDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const PRIORITIES = ["normal", "high"] as const
const CATEGORIES = [
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

const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
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
const PRIORITY_LABEL: Record<(typeof PRIORITIES)[number], string> = {
  normal: "Обычный",
  high: "Высокий",
}

function usePaged<T>(items: T[]) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const effectivePage = Math.min(page, totalPages)
  const start = (effectivePage - 1) * PAGE_SIZE
  const pageItems = items.slice(start, start + PAGE_SIZE)
  return { page: effectivePage, setPage, totalPages, pageItems }
}

function PagerNav({
  page,
  totalPages,
  setPage,
}: {
  page: number
  totalPages: number
  setPage: (p: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            onClick={(e) => {
              e.preventDefault()
              if (page > 1) setPage(page - 1)
            }}
            aria-disabled={page === 1}
            className={
              page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"
            }
          />
        </PaginationItem>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
          <PaginationItem key={p}>
            <PaginationLink
              isActive={p === page}
              onClick={(e) => {
                e.preventDefault()
                setPage(p)
              }}
              className="cursor-pointer"
            >
              {p}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            onClick={(e) => {
              e.preventDefault()
              if (page < totalPages) setPage(page + 1)
            }}
            aria-disabled={page === totalPages}
            className={
              page === totalPages
                ? "pointer-events-none opacity-50"
                : "cursor-pointer"
            }
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

export function CardsFeedSection() {
  const [cards, setCards] = useState<CardRow[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState("")
  const [priority, setPriority] = useState<string>(ALL)
  const [category, setCategory] = useState<string>(ALL)
  // Default view is scoped to the last day; the "Все время" preset clears it.
  const [from, setFrom] = useState<string>(() => isoDateNDaysAgo(1))
  const [to, setTo] = useState<string>(() => todayIso())
  // Accepted cards stay visible (they're a record of approved actions).
  // This toggle only controls visibility of *rejected* cards, which are
  // hidden by default since they were dismissed.
  const [includeRejected, setIncludeRejected] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch("/api/cards")
    const data = await res.json()
    setCards(data.cards ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        await load()
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromTs = from ? new Date(from).getTime() : null
    const toTs = to ? new Date(`${to}T23:59:59.999`).getTime() : null

    return cards.filter((c) => {
      // Hide rejected cards unless the toggle includes them. Accepted
      // cards always pass — they remain on the dashboard as a record of
      // approved actions.
      if (!includeRejected && !!c.rejectionReason) return false

      if (priority !== ALL && c.priority !== priority) return false
      if (category !== ALL && c.category !== category) return false

      if (q) {
        const haystack =
          `${c.message?.analysis ?? ""}\n${c.message?.recommendation ?? ""}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }

      const created = new Date(c.createdAt).getTime()
      if (fromTs !== null && created < fromTs) return false
      if (toTs !== null && created > toTs) return false

      return true
    })
  }, [cards, search, priority, category, from, to, includeRejected])

  const paged = usePaged(filtered)

  const grid = useMemo(
    () =>
      paged.pageItems.map((c) => (
        <DashboardCard key={c.id} card={c} onChanged={load} />
      )),
    [paged.pageItems, load],
  )

  // The default date range is the last day; any deviation counts as a filter.
  const isDefaultDateRange =
    from === isoDateNDaysAgo(1) && to === todayIso()

  const hasFilters =
    search.trim() !== "" ||
    priority !== ALL ||
    category !== ALL ||
    !isDefaultDateRange ||
    includeRejected

  const clearFilters = () => {
    setSearch("")
    setPriority(ALL)
    setCategory(ALL)
    setFrom(isoDateNDaysAgo(1))
    setTo(todayIso())
    setIncludeRejected(false)
  }

  const rejectedCount = cards.filter((c) => !!c.rejectionReason).length

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-xl tracking-wide">
          Утренние карточки
        </CardTitle>
        <div className="flex items-center gap-2">
          <MagicCardsButton onCardsGenerated={load} />
          <ExploreSourcesDialog
            onCardsGenerated={load}
            trigger={
              <Button size="sm">
                <Sparkles className="h-4 w-4 mr-1" />
                Исследовать источники
              </Button>
            }
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Поиск в сообщениях…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-50"
          />
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-fit">
              <SelectValue placeholder="Приоритет" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все приоритеты</SelectItem>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-fit">
              <SelectValue placeholder="Категория" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все категории</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
              {filtered.length} из {cards.length} карточек
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
            <div className="flex justify-center">
              <PagerNav
                page={paged.page}
                totalPages={paged.totalPages}
                setPage={paged.setPage}
              />
            </div>
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
