"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
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
import { Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"
import type {
  DealRow,
  DealFunnelStageOption,
  DealClientOption,
} from "@/app/api/deals/route"
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
import {
  DealKanbanCard,
  DealKanbanCardOverlay,
} from "@/components/blocks/deal-kanban-card"
import {
  DealMoveDialog,
  type PendingMove,
} from "@/components/blocks/deal-move-dialog"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { DiscoverDealsDialog } from "@/components/blocks/discover-deals-dialog"
import { DealDetailDrawer } from "@/components/blocks/deal-detail-drawer"

const ALL = "__all__"

function Column({
  stage,
  deals,
  onChanged,
  onOpen,
}: {
  stage: DealFunnelStageOption
  deals: DealRow[]
  onChanged: () => void
  onOpen: (deal: DealRow) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const colorClass = STAGE_COLOR[stage.name] ?? STAGE_DEFAULT

  return (
    <div className="w-64 shrink-0 flex flex-col gap-2">
      <div className={`rounded-lg border p-2.5 ${colorClass}`}>
        <div className="flex items-baseline justify-between text-sm font-medium">
          <span>{dealStageLabel(stage.name)}</span>
          <span className="text-xs opacity-70">
            {Math.round(stage.closureProbability * 100)}%
          </span>
        </div>
        <div className="text-xs opacity-80 mt-0.5">
          {deals.length} ·{" "}
          {aggregateByCurrency(
            deals.map((d) => ({ amount: dealAmount(d.value), currency: d.currency })),
          )}{" "}
          · взвеш.{" "}
          {aggregateByCurrency(
            deals.map((d) => ({
              amount: dealAmount(d.value) * stage.closureProbability,
              currency: d.currency,
            })),
          )}
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 min-h-24 rounded-lg transition-colors ${
          isOver ? "outline outline-2 outline-dashed outline-primary" : ""
        }`}
      >
        {deals.map((d) => (
          <DealKanbanCard key={d.id} deal={d} onChanged={onChanged} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
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
  const [filter, setFilter] = useState<OwnerFilter>("all")
  const [query, setQuery] = useState("")
  const [clientFilter, setClientFilter] = useState<string>(ALL)
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [includeDeleted, setIncludeDeleted] = useState(false)
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
  const [isPending, startTransition] = useTransition()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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

  const flowStages = stages.filter((s) => !isTerminalStage(s.name))
  const terminalStages = stages.filter((s) => isTerminalStage(s.name))

  const probByStageId = useMemo(
    () => new Map(stages.map((s) => [s.id, s.closureProbability])),
    [stages],
  )
  const openCount = activeDeals.filter(
    (d) => !isTerminalStage(d.funnelStageName),
  ).length

  const dealsByStage = (stageId: string) =>
    boardDeals.filter((d) => d.funnelStageId === stageId)

  const activeDeal = activeId
    ? (activeDeals.find((d) => d.id === activeId) ?? null)
    : null

  const openDeal = openDealId
    ? (deals.find((d) => d.id === openDealId) ?? null)
    : null

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
    const deal = activeDeals.find((d) => d.id === active.id)
    const toStage = stages.find((s) => s.id === over.id)
    if (!deal || !toStage) return
    if (deal.funnelStageId === toStage.id) return
    if (isTerminalStage(toStage.name)) {
      toast("Терминальные стадии защищены — закрытие через карточку сделки")
      return
    }
    const fromStage = stages.find((s) => s.id === deal.funnelStageId)
    setPendingMove({
      dealId: deal.id,
      dealName: deal.name,
      toStageId: toStage.id,
      fromLabel: dealStageLabel(fromStage?.name ?? ""),
      toLabel: dealStageLabel(toStage.name),
      direction: moveDirection(fromStage?.sortOrder ?? 0, toStage.sortOrder),
    })
  }

  function confirmMove(note: string) {
    if (!pendingMove) return
    const move = pendingMove
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
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось перевести сделку")
          return
        }
        toast.success(`Переведено: ${move.toLabel}`)
        setPendingMove(null)
        router.refresh()
      } catch {
        toast.error("Не удалось перевести сделку")
      }
    })
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
                        (probByStageId.get(d.funnelStageId) ?? d.funnelStageProbability),
                      currency: d.currency,
                    })),
                )}
              </b>{" "}
              · открытых: <b className="text-foreground">{openCount}</b>
            </span>
          </div>
          <div className="flex items-center gap-2">
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
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex-1 min-h-0 flex gap-2 overflow-x-auto px-4 pb-4 items-start">
          {flowStages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              deals={dealsByStage(stage.id)}
              onChanged={router.refresh}
              onOpen={(d) => {
                if (justDraggedRef.current) return
                setOpenDealId(d.id)
                setDrawerOpen(true)
              }}
            />
          ))}

          {terminalStages.length > 0 && (
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
        onConfirm={confirmMove}
        onCancel={() => setPendingMove(null)}
      />
      <DealDetailDrawer
        deal={openDeal}
        stages={stages}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onChanged={() => router.refresh()}
      />
    </div>
  )
}
