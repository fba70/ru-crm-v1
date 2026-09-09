"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, RefreshCw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GlobalSearch } from "@/components/blocks/global-search"
import { AiChatTrigger } from "@/components/blocks/global-ai-chat"
import { TabOverview } from "@/components/blocks/analytics/tab-overview"
import { TabTime } from "@/components/blocks/analytics/tab-time"
import { TabSellers } from "@/components/blocks/analytics/tab-sellers"
import { TabClients } from "@/components/blocks/analytics/tab-clients"
import { TabOrders } from "@/components/blocks/analytics/tab-orders"
import { TabProducts } from "@/components/blocks/analytics/tab-products"
import type { SalesAnalytics } from "@/server/analytics"
// Lazily loaded — and it MUST stay that way. The assistant pulls the whole chat
// stack behind it (@ai-sdk/react, ai-elements, Streamdown → Shiki + mermaid +
// katex). Imported eagerly it added ~1.6 GB to this page's dev compile, taking
// the dev server past Node's ~4 GB heap ceiling, where it dies without an error
// (it looks like the server "silently quits" right after the workflow-directive
// pass). Behind `dynamic` the graph is only built when the tab is opened.
const TabAssistant = dynamic(
  () =>
    import("@/components/blocks/analytics/tab-assistant").then(
      (m) => m.TabAssistant,
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-125 w-full rounded-xl" />,
  },
)

type Bounds = { first: string | null; last: string | null }

type PresetKey = "all" | "year" | "quarter" | "month"

const PRESET_LABEL: Record<PresetKey, string> = {
  all: "Весь период",
  year: "Текущий год",
  quarter: "Последние 90 дней",
  month: "Последние 30 дней",
}

const DAY_MS = 86_400_000

/**
 * Resolve a preset to a concrete `[from, to)` window.
 *
 * Relative presets are anchored to the LAST order in the org rather than to
 * today: a demo dataset that sits ahead of (or behind) the wall clock would
 * otherwise render every chart empty, which reads as a bug rather than as an
 * empty filter. The resolved window is always printed under the heading.
 */
function resolveRange(preset: PresetKey, bounds: Bounds) {
  const lastDay = bounds.last ? new Date(`${bounds.last}T00:00:00.000Z`) : new Date()
  const firstDay = bounds.first
    ? new Date(`${bounds.first}T00:00:00.000Z`)
    : new Date(lastDay.getTime() - 365 * DAY_MS)
  // `to` is exclusive, so push past the final day to include it whole.
  const to = new Date(lastDay.getTime() + DAY_MS)

  switch (preset) {
    case "all":
      return { from: firstDay, to }
    case "year":
      return {
        from: new Date(Date.UTC(lastDay.getUTCFullYear(), 0, 1)),
        to: new Date(Date.UTC(lastDay.getUTCFullYear() + 1, 0, 1)),
      }
    case "quarter":
      return { from: new Date(to.getTime() - 90 * DAY_MS), to }
    case "month":
      return { from: new Date(to.getTime() - 30 * DAY_MS), to }
  }
}

const formatDay = (d: Date) =>
  d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })

export default function AnalyticsPage() {
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [preset, setPreset] = useState<PresetKey>("all")
  const [data, setData] = useState<SalesAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/analytics?bounds=1")
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? "Не удалось загрузить период")
        if (!cancelled) setBounds(json as Bounds)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка загрузки")
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const range = useMemo(
    () => (bounds ? resolveRange(preset, bounds) : null),
    [preset, bounds],
  )

  const load = useCallback(async () => {
    if (!range) return
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      })
      const res = await fetch(`/api/analytics?${qs}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Не удалось загрузить аналитику")
      setData(json as SalesAnalytics)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки")
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  const hasOrders = bounds?.first != null

  return (
    <div className="flex flex-col gap-4 p-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium">Аналитика продаж</h1>
          <p className="text-muted-foreground text-xs">
            {range
              ? `${formatDay(range.from)} — ${formatDay(new Date(range.to.getTime() - DAY_MS))}`
              : "Загрузка периода…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AiChatTrigger />
          <GlobalSearch />
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Не удалось загрузить аналитику</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {bounds && !hasOrders ? (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>Пока нет заказов</AlertTitle>
          <AlertDescription>
            Аналитика появится, как только в организации будет создан первый
            заказ.
          </AlertDescription>
        </Alert>
      ) : null}

      {loading && !data ? (
        <AnalyticsSkeleton />
      ) : data ? (
        <Tabs defaultValue="overview" className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="flex-wrap">
              <TabsTrigger value="overview">Обзор</TabsTrigger>
              <TabsTrigger value="time">Время</TabsTrigger>
              <TabsTrigger value="sellers">Продавцы</TabsTrigger>
              <TabsTrigger value="clients">Клиенты</TabsTrigger>
              <TabsTrigger value="orders">Заказы</TabsTrigger>
              <TabsTrigger value="products">Товары</TabsTrigger>
              <TabsTrigger value="assistant">
                <Sparkles className="size-3.5" />
                ИИ ассистент
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Select
                value={preset}
                onValueChange={(v) => setPreset(v as PresetKey)}
                disabled={!hasOrders}
              >
                <SelectTrigger size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRESET_LABEL) as PresetKey[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {PRESET_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load()}
                disabled={loading || !range}
                aria-label="Обновить"
              >
                <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
              </Button>
            </div>
          </div>

          {/* Charts measure their container, so each panel stays mounted only
              while selected — a hidden panel has zero width and would render a
              collapsed chart on first paint. */}
          <TabsContent value="overview">
            <TabOverview data={data} />
          </TabsContent>
          <TabsContent value="time">
            <TabTime data={data} />
          </TabsContent>
          <TabsContent value="sellers">
            <TabSellers data={data} />
          </TabsContent>
          <TabsContent value="clients">
            <TabClients data={data} />
          </TabsContent>
          <TabsContent value="orders">
            <TabOrders data={data} />
          </TabsContent>
          <TabsContent value="products">
            <TabProducts data={data} />
          </TabsContent>
          {/* The assistant runs its own queries against the same semantic model,
              so it needs no payload and is unaffected by the range picker. */}
          <TabsContent value="assistant">
            <TabAssistant />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  )
}

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}
