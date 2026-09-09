"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Ban, Loader, Plus, Sparkles, X } from "lucide-react"
import type {
  ClientRow,
  ClientRevenueSummary,
  ClientFeedTab,
} from "@/app/api/clients/route"
import type { DealRow } from "@/app/api/deals/route"
import type { TaskRow } from "@/app/api/tasks/route"
import ClientEditDialog from "@/components/forms/form-client-edit"
import { ClientCard } from "@/components/blocks/client-card"
import { ClientDetailDrawer } from "@/components/blocks/client-detail-drawer"
import { DiscoverDialog } from "@/components/blocks/discover-dialog"
import { MagicDiscoverButton } from "@/components/blocks/magic-discover-button"
import { ClientEnrichControl } from "@/components/blocks/client-enrich-control"
import { ClientBlocklistDialog } from "@/components/blocks/client-blocklist-dialog"
import { GlobalSearch } from "@/components/blocks/global-search"
import { AiChatTrigger } from "@/components/blocks/global-ai-chat"
import { useInfiniteScroll } from "@/lib/use-infinite-scroll"

const ALL = "__all__"
const PAGE_SIZE = 12

// `deleted`/`blocked` are hidden under the default "All statuses" view; pick
// either explicitly to view/restore.
const CLIENT_STATUSES = [
  "active",
  "initial",
  "suspended",
  "deleted",
  "blocked",
] as const

const STATUS_LABEL: Record<string, string> = {
  active: "Активный",
  initial: "Новый",
  suspended: "Приостановлен",
  deleted: "Удалён",
  blocked: "Заблокирован",
}

const TABS: { value: ClientFeedTab; label: string }[] = [
  { value: "customers", label: "Клиенты" },
  { value: "potential", label: "Потенциальные" },
  { value: "supplier", label: "Поставщики" },
  { value: "partner", label: "Партнёры" },
  { value: "unclassified", label: "Не определено" },
]

export default function ClientsPage() {
  const [tab, setTab] = useState<ClientFeedTab>("customers")
  const [statusFilter, setStatusFilter] = useState<string>(ALL)

  const [rows, setRows] = useState<ClientRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)

  const [revenueByClient, setRevenueByClient] = useState<
    Record<string, ClientRevenueSummary>
  >({})
  const [activeDealByClient, setActiveDealByClient] = useState<
    Record<string, DealRow>
  >({})
  const [tasksByClient, setTasksByClient] = useState<
    Record<string, TaskRow[]>
  >({})
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [canBlock, setCanBlock] = useState(false)

  // Дровер с подробностями компании (по образцу /deals) — открывается по
  // «Подробнее» на карточке вместо перехода на /clients/[id]. Сам объект
  // выводим из живого `rows`, чтобы дровер не устарел после refreshAll.
  const [openClientId, setOpenClientId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const reqIdRef = useRef(0)

  const loadPage = useCallback(
    async (nextOffset: number) => {
      setLoading(true)
      const reqId = ++reqIdRef.current
      try {
        const params = new URLSearchParams({
          tab,
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        })
        if (statusFilter !== ALL) params.set("status", statusFilter)
        const res = await fetch(`/api/clients?${params.toString()}`)
        if (!res.ok || reqIdRef.current !== reqId) return
        const data = await res.json()
        if (reqIdRef.current !== reqId) return
        const newRows: ClientRow[] = data.rows ?? []
        setRows((prev) => (nextOffset === 0 ? newRows : [...prev, ...newRows]))
        setTotal(data.total ?? 0)
        setOffset(nextOffset + newRows.length)
        setHasMore(nextOffset + newRows.length < (data.total ?? 0))
      } finally {
        if (reqIdRef.current === reqId) setLoading(false)
      }
    },
    [tab, statusFilter],
  )

  // Каждый таб/фильтр статуса — независимая лента: смена любого из них
  // сбрасывает накопленные карточки и грузит с начала.
  useEffect(() => {
    setRows([])
    setOffset(0)
    setHasMore(true)
    void loadPage(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter])

  const loadExtras = useCallback(async () => {
    const [revRes, dealsRes, tasksRes] = await Promise.all([
      fetch("/api/clients"),
      fetch("/api/deals"),
      fetch("/api/tasks"),
    ])
    if (revRes.ok) {
      const d = await revRes.json()
      setRevenueByClient(d.revenue12mo ?? {})
    }
    if (dealsRes.ok) {
      const d = await dealsRes.json()
      const deals: DealRow[] = d.deals ?? []
      const byClient: Record<string, DealRow> = {}
      for (const deal of deals) {
        const current = byClient[deal.clientId]
        if (!current || deal.updatedAt > current.updatedAt) {
          byClient[deal.clientId] = deal
        }
      }
      setActiveDealByClient(byClient)
    }
    if (tasksRes.ok) {
      const d = await tasksRes.json()
      const tasks: TaskRow[] = d.tasks ?? []
      const byClient: Record<string, TaskRow[]> = {}
      for (const t of tasks) {
        if (!t.clientId) continue
        ;(byClient[t.clientId] ??= []).push(t)
      }
      for (const list of Object.values(byClient)) {
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      }
      setTasksByClient(byClient)
      setTasksLoaded(true)
    }
  }, [])

  useEffect(() => {
    void loadExtras()
  }, [loadExtras])

  useEffect(() => {
    let cancelled = false
    fetch("/api/blocklist")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setCanBlock(Boolean(d.canManage))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const refreshAll = useCallback(async () => {
    // Не обнуляем `rows` заранее — loadPage(0) сам заменит их, когда придут
    // свежие данные. Иначе открытый ClientDetailDrawer (client берётся из
    // rows.find(...)) на миг терял бы объект и захлопывался сам собой при
    // каждом «Сохранить» внутри него.
    setOffset(0)
    setHasMore(true)
    await Promise.all([loadPage(0), loadExtras()])
  }, [loadPage, loadExtras])

  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    loading,
    onLoadMore: () => void loadPage(offset),
  })

  return (
    <div className="flex flex-col h-[calc(100vh-1rem)]">
      <div className="flex flex-col gap-4 p-4 pb-0 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-medium">Компании</h1>
          <div className="flex items-center gap-2">
            <AiChatTrigger />
            <GlobalSearch />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <DiscoverDialog
            onApplied={refreshAll}
            canBlock={canBlock}
            trigger={
              <Button size="sm" variant="outline">
                <Sparkles className="h-4 w-4 mr-1" />
                Найти в источниках
              </Button>
            }
          />
          <ClientEnrichControl refreshKey={total} onChanged={refreshAll} />
          {canBlock && (
            <ClientBlocklistDialog
              onChanged={refreshAll}
              trigger={
                <Button size="sm" variant="outline">
                  <Ban className="h-4 w-4 mr-1" />
                  Список блокировки
                </Button>
              }
            />
          )}
          <MagicDiscoverButton onApplied={refreshAll} />
          <div className="ml-auto">
            <ClientEditDialog
              mode="create"
              onSuccess={refreshAll}
              trigger={
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Новая компания
                </Button>
              }
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-4 pt-4">
        <Card className="h-full flex flex-col">
          <CardHeader className="gap-3 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Tabs value={tab} onValueChange={(v) => setTab(v as ClientFeedTab)}>
                <TabsList>
                  {TABS.map((t) => (
                    <TabsTrigger key={t.value} value={t.value}>
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-fit">
                    <SelectValue placeholder="Статус" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Все статусы</SelectItem>
                    {CLIENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s] ?? s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {statusFilter !== ALL && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStatusFilter(ALL)}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Сбросить
                  </Button>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {rows.length} из {total} компаний
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-4">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="animate-spin h-6 w-6" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState label="Нет компаний в этом разделе." />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4">
                {rows.map((c) => (
                  <ClientCard
                    key={c.id}
                    client={c}
                    onChanged={refreshAll}
                    canBlock={canBlock}
                    revenue={revenueByClient[c.id]}
                    activeDeal={activeDealByClient[c.id]}
                    tasks={tasksByClient[c.id] ?? []}
                    tasksLoaded={tasksLoaded}
                    onOpenDetail={(id) => {
                      setOpenClientId(id)
                      setDrawerOpen(true)
                    }}
                  />
                ))}
              </div>
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center py-6"
                >
                  {loading && <Loader className="animate-spin h-5 w-5" />}
                </div>
              )}
            </>
          )}
        </CardContent>
        </Card>
      </div>

      <ClientDetailDrawer
        client={rows.find((r) => r.id === openClientId) ?? null}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onChanged={refreshAll}
      />
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
