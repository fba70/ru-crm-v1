"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
} from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Plus, Sparkles, ListTree } from "lucide-react"
import { toast } from "sonner"
import type {
  DealRow,
  DealFunnelStageOption,
  DealClientOption,
} from "@/app/api/deals/route"
import type { DealProposal } from "@/server/deals-mock"
import { dealStageLabel } from "@/lib/deal-funnel"
import {
  STAGE_COLOR,
  STAGE_DEFAULT,
  aggregateByCurrency,
  dealAmount,
  filterByOwner,
  isTerminalStage,
  moveDirection,
  type OwnerFilter,
} from "@/lib/deal-board"
import { DealKanbanCardOverlay } from "@/components/blocks/deal-kanban-card"
import {
  DealMoveDialog,
  type PendingMove,
} from "@/components/blocks/deal-move-dialog"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { DiscoverDealsDialog } from "@/components/blocks/discover-deals-dialog"
import { DealDetailDrawer } from "@/components/blocks/deal-detail-drawer"
import { DealDecisionFeed } from "@/components/blocks/deal-decision-feed"
import { useBoardIntel } from "@/hooks/use-board-intel"
import { computePosition } from "@/lib/kanban-move"
import { Column } from "./deals-kanban/column"
import { Rail } from "./deals-kanban/rail"
import { useBoardStore, type SortMode } from "./deals-kanban/store"

const ALL = "__all__"

type OverData = { type?: "card" | "column"; stageId?: string; dealId?: string }

// Collision: prefer VISIBLE card droppables (precise before/after), fall back to
// the column body, then rect intersection. Off-screen cards aren't mounted, so
// they aren't droppables — composes with collapse (collapsed cols are Rails).
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  const cardHits = pointer.filter((c) => String(c.id).startsWith("card:"))
  if (cardHits.length > 0) return cardHits
  if (pointer.length > 0) return pointer
  return rectIntersection(args)
}

export function DealsBoard({
  deals,
  stages,
  currentUserId,
  clientOptions = [],
}: {
  deals: DealRow[]
  stages: DealFunnelStageOption[]
  currentUserId: string
  clientOptions?: DealClientOption[]
}) {
  const router = useRouter()
  const { data: board, loading: boardLoading, refetch: refetchBoard } =
    useBoardIntel()
  const [filter, setFilter] = useState<OwnerFilter>("all")
  const [query, setQuery] = useState("")
  const [clientFilter, setClientFilter] = useState<string>(ALL)
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [feedOpen, setFeedOpen] = useState(false)
  // Тумблер «только предложения агента»: скрывает обычные карточки, оставляя
  // на доске лишь ghost-предложения.
  const [proposalsOnly, setProposalsOnly] = useState(false)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Храним id открытой сделки, а объект выводим из живого `deals` — drawer
  // всегда показывает актуальные данные после refresh (редактирование, перевод
  // стадии с другой карточки и т.п.), без устаревшего снимка.
  const [openDealId, setOpenDealId] = useState<string | null>(null)
  // Открытость drawer развязана с выбранной сделкой: при закрытии гасим
  // drawerOpen, но openDealId сохраняем — чтобы deal оставался смонтированным
  // на время exit-анимации Sheet (иначе закрытие происходит без анимации).
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Гасим клик-после-перетаскивания: dnd-kit может породить синтетический click
  // после короткого drag — не открываем drawer в этом случае.
  const justDraggedRef = useRef(false)
  const boardScrollRef = useRef<HTMLDivElement>(null)
  const [isPending, startTransition] = useTransition()

  const refresh = () => {
    router.refresh()
    refetchBoard()
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return filterByOwner(deals, filter, currentUserId).filter((d) => {
      if (clientFilter !== ALL && d.clientId !== clientFilter) return false
      if (q) {
        const inName = d.name.toLowerCase().includes(q)
        const inDesc = (d.description ?? "").toLowerCase().includes(q)
        if (!inName && !inDesc) return false
      }
      return true
    })
  }, [deals, filter, currentUserId, query, clientFilter])

  const activeDeals = useMemo(
    () => filtered.filter((d) => d.status === "active"),
    [filtered],
  )

  const boardDeals = useMemo(
    () =>
      filtered.filter((d) => {
        if (d.status === "active") return true
        if (d.status === "cancelled") return includeCancelled
        if (d.status === "deleted") return includeDeleted
        return false
      }),
    [filtered, includeCancelled, includeDeleted],
  )

  const flowStages = useMemo(
    () => stages.filter((s) => !isTerminalStage(s.name)),
    [stages],
  )
  const terminalStages = stages.filter((s) => isTerminalStage(s.name))

  // Store: группировка по стадиям, per-column сортировка, сворачивание,
  // оптимистичный reorder внутри колонки (moveOnly+position без диалога).
  const store = useBoardStore({
    deals: boardDeals,
    stages: flowStages,
    onChanged: refresh,
    boardId: currentUserId,
  })

  const probByStageId = useMemo(
    () => new Map(stages.map((s) => [s.id, s.closureProbability])),
    [stages],
  )
  const openCount = activeDeals.filter(
    (d) => !isTerminalStage(d.funnelStageName),
  ).length

  // Предложения агента показываем только для видимых (после фильтров) сделок.
  const visibleProposals = useMemo(() => {
    const ids = new Set(boardDeals.map((d) => d.id))
    return board.proposals.filter((p) => ids.has(p.dealId))
  }, [board.proposals, boardDeals])

  const proposalsByStage = useMemo(() => {
    const map = new Map<string, DealProposal[]>()
    for (const p of visibleProposals) {
      const list = map.get(p.toStageId) ?? []
      list.push(p)
      map.set(p.toStageId, list)
    }
    return map
  }, [visibleProposals])

  const dealsWithProposal = useMemo(
    () => new Set(visibleProposals.map((p) => p.dealId)),
    [visibleProposals],
  )

  // Активен режим фильтра только если есть что показывать — иначе доска не
  // «схлопывается» в пустоту (и кнопка авто-гаснет, когда предложений не стало).
  const proposalsOnlyActive = proposalsOnly && visibleProposals.length > 0

  const activeDeal = activeId ? (store.dealById(activeId) ?? null) : null

  const openDeal = openDealId
    ? (deals.find((d) => d.id === openDealId) ?? null)
    : null

  const stageLabelOf = (stageId?: string) => {
    const s = stages.find((st) => st.id === stageId)
    return s ? dealStageLabel(s.name) : null
  }

  const announcements: Announcements = {
    onDragStart({ active }) {
      const d = store.dealById(String(active.id))
      return d ? `Взята сделка «${d.name}».` : undefined
    },
    onDragOver({ over }) {
      const label = stageLabelOf((over?.data.current as OverData)?.stageId)
      return label ? `Над колонкой «${label}».` : undefined
    },
    onDragEnd({ active, over }) {
      const d = store.dealById(String(active.id))
      const label = stageLabelOf((over?.data.current as OverData)?.stageId)
      return d && label
        ? `Сделка «${d.name}» перемещена в «${label}».`
        : "Перемещение отменено."
    },
    onDragCancel() {
      return "Перемещение отменено."
    },
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    // Был drag — подавляем возможный последующий click по карточке.
    justDraggedRef.current = true
    setTimeout(() => {
      justDraggedRef.current = false
    }, 0)
    const { active, over } = event
    if (!over) return
    const dealId = String(active.id)
    const overData = over.data.current as OverData | undefined
    const toStageId = overData?.stageId
    if (!toStageId) return
    const moving = boardDeals.find((d) => d.id === dealId)
    if (!moving) return
    const fromStageId = moving.funnelStageId

    // Перемещение ВНУТРИ колонки (стадия не меняется) → оптимистичный reorder,
    // без диалога (механика fba70).
    if (toStageId === fromStageId) {
      const targetCol = store.columns.find((c) => c.stage.id === toStageId)
      const targetMode: SortMode = targetCol?.mode ?? "manual"
      let beforeId: string | null = null
      let afterId: string | null = null
      if (overData?.type === "card" && overData.dealId) {
        if (overData.dealId === dealId) return // сброшено на себя
        const activeRect = active.rect.current.translated
        const overRect = over.rect
        const insertAfter =
          activeRect != null
            ? activeRect.top + activeRect.height / 2 >
              overRect.top + overRect.height / 2
            : false
        const disp = (targetCol?.cards ?? []).filter((c) => c.id !== dealId)
        const overIdx = disp.findIndex((c) => c.id === overData.dealId)
        if (overIdx === -1) {
          beforeId = disp.at(-1)?.id ?? null
        } else if (insertAfter) {
          beforeId = disp[overIdx].id
          afterId = disp[overIdx + 1]?.id ?? null
        } else {
          beforeId = disp[overIdx - 1]?.id ?? null
          afterId = disp[overIdx].id
        }
      }
      store.move(dealId, toStageId, beforeId, afterId, targetMode)
      return
    }

    // Смена стадии → наш диалог с заметкой (ours приоритетнее).
    const toStage = stages.find((s) => s.id === toStageId)
    if (!toStage) return
    if (isTerminalStage(toStage.name)) {
      toast("Терминальные стадии защищены — закрытие через карточку сделки")
      return
    }
    if (store.collapsed[toStageId]) store.expand(toStageId)
    const fromStage = stages.find((s) => s.id === fromStageId)
    setPendingMove({
      dealId: moving.id,
      dealName: moving.name,
      toStageId: toStage.id,
      fromLabel: dealStageLabel(fromStage?.name ?? ""),
      toLabel: dealStageLabel(toStage.name),
      direction: moveDirection(fromStage?.sortOrder ?? 0, toStage.sortOrder),
    })
  }

  function confirmMove(note: string) {
    if (!pendingMove) return
    const move = pendingMove
    // Append в конец целевой колонки (по manual-порядку), чтобы порядок внутри
    // стадии остался консистентным при кросс-стадийном переводе.
    const targetCards = boardDeals.filter(
      (d) => d.funnelStageId === move.toStageId && d.id !== move.dealId,
    )
    const lastKeyed =
      targetCards
        .map((d) => d.position)
        .filter((p): p is string => Boolean(p))
        .sort()
        .at(-1) ?? null
    let position: string | null = null
    try {
      position = computePosition(lastKeyed, null)
    } catch {
      position = null
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: move.dealId,
            move: true,
            funnelStageId: move.toStageId,
            note,
            position,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось перевести сделку")
          return
        }
        toast.success(`Переведено: ${move.toLabel}`)
        setPendingMove(null)
        refresh()
      } catch {
        toast.error("Не удалось перевести сделку")
      }
    })
  }

  function handleAccept(id: string) {
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: "accept" }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось принять предложение")
          return
        }
        toast.success("Предложение принято")
        refresh()
      } catch {
        toast.error("Не удалось принять предложение")
      }
    })
  }

  function handleReject(id: string, reason: string) {
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: "reject", reason }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось отклонить предложение")
          return
        }
        toast("Предложение отклонено")
        refetchBoard()
      } catch {
        toast.error("Не удалось отклонить предложение")
      }
    })
  }

  function handleProposalsChip() {
    // Тумблер: включаем режим «только предложения», повторный клик — выключаем.
    if (!proposalsOnly && visibleProposals.length === 0) {
      toast("Нет ожидающих предложений — агент применил всё, что мог, автоматически")
      return
    }
    setProposalsOnly((v) => !v)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Обёртка центрирует доску и сжимается по ширине колонок; шапка
          (растягивается по ширине этой обёртки) получает ту же ширину. */}
      <div className="mx-auto flex h-full min-h-0 w-full max-w-fit flex-col">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-4 flex-wrap">
              <h1 className="text-lg font-semibold uppercase tracking-wide">
                Сделки
              </h1>
              <span className="text-sm text-muted-foreground">
                взвешенный прогноз{" "}
                <b className="text-foreground">
                  {aggregateByCurrency(
                    activeDeals
                      .filter((d) => !isTerminalStage(d.funnelStageName))
                      .map((d) => ({
                        amount:
                          dealAmount(d.value) *
                          (probByStageId.get(d.funnelStageId) ??
                            d.funnelStageProbability),
                        currency: d.currency,
                      })),
                  )}
                </b>{" "}
                · открытых: <b className="text-foreground">{openCount}</b>
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant={proposalsOnlyActive ? "default" : "outline"}
                onClick={handleProposalsChip}
                aria-pressed={proposalsOnlyActive}
                className={
                  !proposalsOnlyActive && visibleProposals.length > 0
                    ? "border-violet-500/40 text-violet-600 dark:text-violet-300"
                    : ""
                }
              >
                <Sparkles className="h-4 w-4 mr-1" />
                Предложения агента
                <span className="ml-1.5 inline-flex items-center justify-center rounded bg-violet-500/20 px-1.5 text-xs font-medium">
                  {visibleProposals.length}
                </span>
              </Button>
              <Button
                size="sm"
                variant={feedOpen ? "default" : "outline"}
                onClick={() => setFeedOpen((v) => !v)}
              >
                <ListTree className="h-4 w-4 mr-1" />
                Лента решений
              </Button>
              <DiscoverDealsDialog
                onDealsGenerated={router.refresh}
                trigger={
                  <Button size="sm" variant="secondary">
                    <Sparkles className="h-4 w-4 mr-1" />
                    Найти в источниках
                  </Button>
                }
              />
              <DealEditDialog
                mode="create"
                onSuccess={router.refresh}
                trigger={
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Новая сделка
                  </Button>
                }
              />
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap rounded-lg border bg-card shadow-sm p-3">
            <div className="flex rounded-lg border overflow-hidden">
              <Button
                variant={filter === "all" ? "default" : "ghost"}
                size="sm"
                className="rounded-none"
                onClick={() => setFilter("all")}
              >
                Все
              </Button>
              <Button
                variant={filter === "mine" ? "default" : "ghost"}
                size="sm"
                className="rounded-none"
                onClick={() => setFilter("mine")}
              >
                Мои
              </Button>
            </div>
            <Input
              placeholder="Поиск по названию или описанию…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 min-w-45"
            />
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Клиент" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все клиенты</SelectItem>
                {clientOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Checkbox
                checked={includeCancelled}
                onCheckedChange={(v) => setIncludeCancelled(Boolean(v))}
              />
              Отменённые
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Checkbox
                checked={includeDeleted}
                onCheckedChange={(v) => setIncludeDeleted(Boolean(v))}
              />
              Удалённые
            </label>
          </div>
        </div>

        <DndContext
          id="deals-board"
          sensors={sensors}
          collisionDetection={collisionDetection}
          accessibility={{ announcements }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div
            ref={boardScrollRef}
            className="flex-1 min-h-0 flex gap-2 overflow-x-auto px-4 pb-4 items-start"
          >
            {store.columns.map((column) => {
              const stageGhosts = proposalsByStage.get(column.stage.id) ?? []
              return store.collapsed[column.stage.id] ? (
                <Rail
                  key={column.stage.id}
                  stage={column.stage}
                  count={column.cards.length}
                  onExpand={() => store.expand(column.stage.id)}
                />
              ) : (
                <Column
                  key={column.stage.id}
                  column={column}
                  ghosts={stageGhosts}
                  intelById={board.intel}
                  nextStepByDeal={board.nextStepByDeal}
                  dealsWithProposal={dealsWithProposal}
                  commitments={board.commitments[column.stage.id] ?? []}
                  pending={isPending}
                  intelLoaded={!boardLoading}
                  hideDeals={proposalsOnlyActive}
                  onChanged={refresh}
                  onOpen={(d) => {
                    if (justDraggedRef.current) return
                    setOpenDealId(d.id)
                    setDrawerOpen(true)
                  }}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  onCollapse={() => store.toggleCollapse(column.stage.id)}
                  onSortChange={(mode) => store.setSort(column.stage.id, mode)}
                />
              )
            })}

            {terminalStages.length > 0 && !proposalsOnlyActive && (
              <div className="w-44 shrink-0 flex flex-col gap-2">
                <div className="rounded-lg border p-2.5 bg-muted/40">
                  <div className="text-sm font-medium">Итоги</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    терминальные стадии
                  </div>
                </div>
                {terminalStages.map((stage) => {
                  const items = activeDeals.filter(
                    (d) => d.funnelStageId === stage.id,
                  )
                  return (
                    <div
                      key={stage.id}
                      className={`rounded-lg p-2.5 text-sm ${
                        STAGE_COLOR[stage.name] ?? STAGE_DEFAULT
                      }`}
                    >
                      <div className="font-medium">
                        {dealStageLabel(stage.name)} · {items.length}
                      </div>
                      <div className="text-xs opacity-80">
                        {aggregateByCurrency(
                          items.map((d) => ({
                            amount: dealAmount(d.value),
                            currency: d.currency,
                          })),
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <DragOverlay>
            {activeDeal ? <DealKanbanCardOverlay deal={activeDeal} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      <DealMoveDialog
        move={pendingMove}
        pending={isPending}
        commitments={
          pendingMove ? (board.commitments[pendingMove.toStageId] ?? []) : []
        }
        onConfirm={confirmMove}
        onCancel={() => setPendingMove(null)}
      />
      <DealDetailDrawer
        deal={openDeal}
        stages={stages}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onChanged={refresh}
      />
      <DealDecisionFeed
        open={feedOpen}
        onOpenChange={setFeedOpen}
        events={board.feed}
      />
    </div>
  )
}
