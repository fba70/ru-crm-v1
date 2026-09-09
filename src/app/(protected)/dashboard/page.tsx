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
import { Sparkles } from "lucide-react"
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

export default function DashboardPage() {
  const [cards, setCards] = useState<CardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [priority, setPriority] = useState<string>(ALL)
  const [category, setCategory] = useState<string>(ALL)

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

  return (
    <div className="flex flex-col h-[calc(100vh-1rem)]">
      <div className="flex flex-col gap-4 p-4 pb-0 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-medium">AI операционная система для бизнеса</h1>
          <div className="flex items-center gap-2">
            <AiChatTrigger />
            <GlobalSearch />
          </div>
        </div>

        {/* Вынесено из CardsFeedSection наверх, по образцу тулбара /clients:
            источники + Magic слева, фильтры справа. */}
        <div className="flex items-center gap-2 flex-wrap">
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
          <div className="ml-auto flex items-center gap-2">
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
        </div>
      </div>

      <div className="flex-1 min-h-0 p-4 pt-4">
        <CardsFeedSection
          cards={cards}
          loading={loading}
          onChanged={load}
          priority={priority}
          onPriorityChange={setPriority}
          category={category}
          onCategoryChange={setCategory}
        />
      </div>
    </div>
  )
}
