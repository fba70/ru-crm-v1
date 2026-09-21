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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  AlertTriangle,
  Ban,
  Loader,
  Plus,
  Rows4,
  Sparkles,
  PlayingCardsFan,
  X,
} from "lucide-react"
import type {
  ClientRow,
  ClientRevenueSummary,
  ClientFeedTab,
} from "@/app/api/clients/route"
import type { DealRow } from "@/app/api/deals/route"
import type { TaskRow } from "@/app/api/tasks/route"
import type { ClientDetail } from "@/server/client-content"
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
const TAB_ALL: ClientFeedTab = "all"
const PAGE_SIZE = 12

type ClientView = "cards" | "table"

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
  const [tab, setTab] = useState<ClientFeedTab>("all")
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
  // Отличаем «реально пусто» от «запрос не выполнился» (сеть/БД) — иначе
  // сбой рендерится как «нет компаний», что читается как потеря данных.
  const [loadError, setLoadError] = useState(false)

  // Дровер с подробностями компании (по образцу /deals) — открывается по
  // «Подробнее» на карточке вместо перехода на /clients/[id]. Сам объект
  // выводим из живого `rows`, чтобы дровер не устарел после refreshAll.
  const [openClientId, setOpenClientId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [view, setView] = useState<ClientView>("cards")

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
        if (reqIdRef.current !== reqId) return
        if (!res.ok) {
          setLoadError(true)
          return
        }
        const data = await res.json()
        if (reqIdRef.current !== reqId) return
        setLoadError(false)
        const newRows: ClientRow[] = data.rows ?? []
        setRows((prev) => (nextOffset === 0 ? newRows : [...prev, ...newRows]))
        setTotal(data.total ?? 0)
        setOffset(nextOffset + newRows.length)
        setHasMore(nextOffset + newRows.length < (data.total ?? 0))
      } catch {
        if (reqIdRef.current === reqId) setLoadError(true)
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

  // Deep-link (from global search / notifications / card chips): /clients?openClient=<id>.
  // The id may not be in the currently loaded tab's rows, so fetch the full
  // detail and map it down to the list shape ClientDetailDrawer expects —
  // same mapping client-detail-shell.tsx already does for its own edit form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const clientId = params.get("openClient")
    if (!clientId) return
    window.history.replaceState(null, "", window.location.pathname)
    void (async () => {
      const res = await fetch(`/api/clients?id=${encodeURIComponent(clientId)}`)
      if (!res.ok) return
      const data: { client?: ClientDetail } = await res.json()
      const d = data.client
      if (!d) return
      const row: ClientRow = {
        id: d.id,
        name: d.name,
        namePhys: d.namePhys,
        comment: d.comment,
        aliases: d.aliases,
        phone: d.phone,
        email: d.email,
        address: d.address,
        webUrl: d.webUrl,
        customFields: d.customFields,
        funnelPhase: d.funnelPhase,
        status: d.status,
        currency: d.currency,
        userId: d.userId,
        userName: d.userName,
        organizationId: d.organizationId,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        contacts: d.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          nameNative: c.nameNative,
          email: c.email,
          phone: c.phone,
          position: c.position,
          status: c.status,
        })),
      }
      setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]))
      setOpenClientId(row.id)
      setDrawerOpen(true)
    })()
  }, [])

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

        {/* «Новая компания» — первой, слева; селекты типа/статуса следом;
            «Найти в источниках»/«Обогатить»/«Список блокировки»/Magic —
            прижаты вправо, переключатель вида — правее всех кнопок. Белый
            контейнер — как на Сделках/Домашней. */}
        <div className="flex items-center gap-2 flex-wrap rounded-xl border bg-card p-3">
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
          <Select value={tab} onValueChange={(v) => setTab(v as ClientFeedTab)}>
            <SelectTrigger size="sm" className="w-fit">
              <SelectValue placeholder="Тип компании" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TAB_ALL}>Все компании</SelectItem>
              {TABS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger size="sm" className="w-fit">
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
            <Button variant="ghost" size="sm" onClick={() => setStatusFilter(ALL)}>
              <X className="h-4 w-4 mr-1" />
              Сбросить
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
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
            <Tabs value={view} onValueChange={(v) => setView(v as ClientView)}>
              <TabsList>
                <TabsTrigger value="cards" aria-label="Вид карточками" title="в виде карточек">
                  <PlayingCardsFan className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="table" aria-label="Вид таблицей" title="списком">
                  <Rows4 className="h-4 w-4" />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Без внешнего Card-контейнера — как на Задачах, заголовок страницы
          достаточен. */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 p-4 pt-4">
        <div className="text-xs text-muted-foreground shrink-0">
          {rows.length} из {total} компаний
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="animate-spin h-6 w-6" />
            </div>
          ) : loadError && rows.length === 0 ? (
            <LoadErrorState onRetry={() => void loadPage(0)} />
          ) : rows.length === 0 ? (
            <EmptyState label="Нет компаний в этом разделе." />
          ) : view === "cards" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {rows.map((c) => (
                  <ClientCard
                    key={c.id}
                    client={c}
                    onChanged={refreshAll}
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
          ) : (
            <>
              <Card className="py-0">
                <CardContent className="p-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Компания</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Телефон</TableHead>
                        <TableHead>Выручка за 12 мес.</TableHead>
                        <TableHead>Статус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((c) => {
                        const rev = revenueByClient[c.id]
                        return (
                          <TableRow
                            key={c.id}
                            className="cursor-pointer even:bg-muted/40"
                            onClick={() => {
                              setOpenClientId(c.id)
                              setDrawerOpen(true)
                            }}
                          >
                            <TableCell>
                              <div className="font-medium">{c.name}</div>
                              {c.namePhys && (
                                <div className="text-xs text-muted-foreground">
                                  {c.namePhys}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{c.email ?? "—"}</TableCell>
                            <TableCell>{c.phone ?? "—"}</TableCell>
                            <TableCell>
                              {rev && rev.revenue > 0
                                ? `${Math.round(rev.revenue).toLocaleString("ru-RU")} · ${rev.orders} зак.`
                                : "нет заказов"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {STATUS_LABEL[c.status] ?? c.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
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
        </div>
      </div>

      <ClientDetailDrawer
        client={rows.find((r) => r.id === openClientId) ?? null}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onChanged={refreshAll}
        canBlock={canBlock}
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

// Отдельно от EmptyState — сбой загрузки (сеть/БД) не должен читаться как
// «компаний нет», иначе выглядит как потеря данных.
function LoadErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="border-dashed border-destructive/40 bg-destructive/5">
      <CardHeader className="items-center text-center gap-3">
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <CardTitle className="text-base font-normal text-muted-foreground">
          Не удалось загрузить компании. Проверьте соединение и попробуйте ещё раз.
        </CardTitle>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Повторить
        </Button>
      </CardHeader>
    </Card>
  )
}
