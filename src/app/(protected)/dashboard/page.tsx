"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Sparkles, X } from "lucide-react"
import type { CardRow } from "@/app/api/cards/route"
import {
  CardsFeedSection,
  ALL,
  PRIORITIES,
  CATEGORIES,
  PRIORITY_LABEL,
  CATEGORY_LABEL,
} from "@/components/blocks/cards-feed-section"
import { ExploreSourcesDialog } from "@/components/blocks/explore-sources-dialog"
import { MagicCardsButton } from "@/components/blocks/magic-cards-button"
import { GlobalSearch } from "@/components/blocks/global-search"
import { AiChatTrigger } from "@/components/blocks/global-ai-chat"

function isoDateNDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

type PeriodPreset = "day" | "week" | "all"

export default function DashboardPage() {
  const [cards, setCards] = useState<CardRow[]>([])
  const [loading, setLoading] = useState(true)
  // Отличаем «реально пусто» от «запрос не выполнился» (сеть/БД) — иначе
  // сбой рендерится как «карточек нет», что читается как потеря данных.
  const [loadError, setLoadError] = useState(false)
  const [priority, setPriority] = useState<string>(ALL)
  const [category, setCategory] = useState<string>(ALL)

  // Default view is unscoped ("Все время") — decided on the 18.09 call:
  // creation date isn't a useful default narrowing here ("мне все равно,
  // когда они были"). "За день"/"За неделю" are presets the operator opts
  // into, not the starting state.
  const [from, setFrom] = useState<string>("")
  const [to, setTo] = useState<string>("")
  // Accepted cards stay visible (they're a record of approved actions).
  // This toggle only controls visibility of *rejected* cards, which are
  // hidden by default since they were dismissed.
  const [includeRejected, setIncludeRejected] = useState(false)

  const isDayRange = from === isoDateNDaysAgo(1) && to === todayIso()
  const isWeekRange = from === isoDateNDaysAgo(7) && to === todayIso()
  const period: PeriodPreset = isDayRange ? "day" : isWeekRange ? "week" : "all"

  const applyPeriod = (v: string) => {
    if (v === "day") {
      setFrom(isoDateNDaysAgo(1))
      setTo(todayIso())
    } else if (v === "week") {
      setFrom(isoDateNDaysAgo(7))
      setTo(todayIso())
    } else {
      setFrom("")
      setTo("")
    }
  }

  const clearFilters = () => {
    setPriority(ALL)
    setCategory(ALL)
    setFrom("")
    setTo("")
    setIncludeRejected(false)
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cards")
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const data = await res.json()
      setLoadError(false)
      setCards(data.cards ?? [])
    } catch {
      setLoadError(true)
    }
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

  return (
    <div className="flex flex-col h-[calc(100vh-1rem)]">
      <div className="flex flex-col gap-4 p-4 pb-0 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-medium">Домашняя</h1>
          <div className="flex items-center gap-2">
            <AiChatTrigger />
            <GlobalSearch />
          </div>
        </div>

        {/* Селекты приоритета/категории + датапикеры + сегментед периода +
            чекбокс отклонённых — прижаты влево; «Найти в источниках»/Magic —
            прижаты вправо (по образцу /clients). */}
        <div className="flex items-center gap-3 flex-wrap rounded-xl border bg-card p-3">
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger size="sm" className="w-fit">
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
            <SelectTrigger size="sm" className="w-fit">
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

          <div className="flex items-center gap-2">
            <Label htmlFor="cards-from" className="text-xs text-muted-foreground">
              С
            </Label>
            <Input
              id="cards-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-fit h-8"
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
              className="w-fit h-8"
            />
          </div>
          {(from || to) && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Сбросить период"
              aria-label="Сбросить период"
              onClick={() => {
                setFrom("")
                setTo("")
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          )}

          <Tabs value={period} onValueChange={applyPeriod}>
            <TabsList>
              <TabsTrigger value="day">За день</TabsTrigger>
              <TabsTrigger value="week">За неделю</TabsTrigger>
              <TabsTrigger value="all">Все время</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <Checkbox
              id="cards-include-rejected"
              checked={includeRejected}
              onCheckedChange={(v) => setIncludeRejected(v === true)}
            />
            <Label htmlFor="cards-include-rejected" className="text-xs cursor-pointer">
              Отклонённые
            </Label>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ExploreSourcesDialog
              onCardsGenerated={load}
              trigger={
                <Button size="sm" variant="outline">
                  <Sparkles className="h-4 w-4 mr-1" />
                  Найти в источниках
                </Button>
              }
            />
            <MagicCardsButton onCardsGenerated={load} />
          </div>
        </div>
      </div>

      {/* Без внешнего Card-контейнера — как на Компаниях/Задачах/Контактах,
          заголовок страницы достаточен. */}
      <div className="flex-1 min-h-0 p-4 pt-4">
        <CardsFeedSection
          cards={cards}
          loading={loading}
          loadError={loadError}
          onRetry={() => void load()}
          onChanged={load}
          priority={priority}
          category={category}
          from={from}
          to={to}
          includeRejected={includeRejected}
          onClearFilters={clearFilters}
        />
      </div>
    </div>
  )
}
