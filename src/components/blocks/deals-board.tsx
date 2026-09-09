"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Plus,
  Sparkles,
  ListTree,
  ChevronsRightLeft,
  ChevronsLeftRight,
  ChevronsUpDown,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import type {
  DealRow,
  DealFunnelStageOption,
  DealClientOption,
} from "@/app/api/deals/route"
import { dealStageLabel } from "@/lib/deal-funnel"
import {
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
import { GlobalSearch } from "@/components/blocks/global-search"
import { AiChatTrigger } from "@/components/blocks/global-ai-chat"
import { useBoardIntel } from "@/hooks/use-board-intel"
import {
  DealOutcomeDialog,
  type PendingOutcome,
} from "@/components/blocks/deal-outcome-dialog"
import { computePosition } from "@/lib/kanban-move"
import { Column } from "./deals-kanban/column"
import { Rail } from "./deals-kanban/rail"
import { TerminalColumn, FINAL_DROP_ID } from "./deals-kanban/terminal-column"
import {
  useBoardStore,
  sortTerminalCards,
  type SortMode,
  type TerminalSortMode,
} from "./deals-kanban/store"

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

// Мультиселект-комбобокс клиентов (UX №17): ЕДИНСТВЕННЫЙ фильтр вместо
// «поиск по названию + селект клиента». Клик открывает дропдаун со всеми
// клиентами (выбор чекбоксами, мультивыбор), поле сверху фильтрует список по
// вводу. Построен на Popover + Input + Checkbox — тот же рабочий паттерн, что
// `MultiFilterSelect` на /products. Пусто = все клиенты.
function ClientMultiSelect({
  values,
  options,
  onToggle,
  onClear,
}: {
  values: string[]
  options: DealClientOption[]
  onToggle: (id: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const selected = new Set(values)
  const query = q.trim().toLowerCase()
  const visible = query
    ? options.filter((c) => c.name.toLowerCase().includes(query))
    : options
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 flex-1 min-w-52 justify-between font-normal"
        >
          <span className="truncate">
            {values.length === 0
              ? "Все клиенты"
              : `Клиентов выбрано: ${values.length}`}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-60 p-0"
      >
        <div className="border-b p-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск клиента…"
            className="h-8"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {values.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              Очистить выбор
            </button>
          )}
          {visible.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              Ничего не найдено
            </div>
          ) : (
            visible.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={selected.has(c.id)}
                  onCheckedChange={() => onToggle(c.id)}
                />
                <span className="truncate">{c.name}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
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
  const { data: board, loading: boardLoading, refetch: refetchBoard } =
    useBoardIntel()
  const [filter, setFilter] = useState<OwnerFilter>("all")
  // Мультивыбор клиентов (пусто = все). Заменил и поиск по названию, и селект.
  const [clientFilters, setClientFilters] = useState<string[]>([])
  // «Не состоялись» (бывший чекбокс «Удалённые») — раскрывает проигранные
  // карточки в колонке «Закрытие» под разделителем (по умолчанию скрыты).
  // Удалённые сделки (ошибки ввода) больше вообще не показываются на доске.
  const [showLostDeals, setShowLostDeals] = useState(false)
  // Фильтр «двигал агент» (бывшая кнопка «Предложения агента» — по сути фильтр,
  // задача UX №19): показывает только сделки с lastMovedBy === 'agent'.
  const [agentMovedOnly, setAgentMovedOnly] = useState(false)
  const [feedOpen, setFeedOpen] = useState(false)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  // Диалог исхода при дропе в финальную колонку (Выиграно→Closed / Проиграно→
  // Rejected). Отдельная сортировка финальной колонки (view-only).
  const [pendingOutcome, setPendingOutcome] = useState<PendingOutcome | null>(
    null,
  )
  const [finalSort, setFinalSort] = useState<TerminalSortMode>("default")
  // Сворачивание финальной колонки (как у обычных, но её нет в store —
  // держим отдельным флагом; учитывается в «Свернуть/Развернуть все»).
  const [finalCollapsed, setFinalCollapsed] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Храним id открытой сделки, а объект выводим из живого `deals` — drawer
  // всегда показывает актуальные данные после refresh (редактирование, перевод
  // стадии с другой карточки и т.п.), без устаревшего снимка.
  const [openDealId, setOpenDealId] = useState<string | null>(null)
  // Открытость drawer развязана с выбранной сделкой: при закрытии гасим
  // drawerOpen, но openDealId сохраняем — чтобы deal оставался смонтированным
  // на время exit-анимации Sheet (иначе закрытие происходит без анимации).
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Deep-link из глобального поиска (/deals?openDeal=<id>): доска уже
  // загружает ВСЕ сделки (includeCancelled+includeDeleted на уровне страницы),
  // поэтому открыть найденную сделку — то же самое, что клик по карточке.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const dealId = params.get("openDeal")
    if (!dealId) return
    window.history.replaceState(null, "", window.location.pathname)
    setOpenDealId(dealId)
    setDrawerOpen(true)
  }, [])
  // Гасим клик-после-перетаскивания: dnd-kit может породить синтетический click
  // после короткого drag — не открываем drawer в этом случае.
  const justDraggedRef = useRef(false)
  const boardScrollRef = useRef<HTMLDivElement>(null)
  const [isPending, startTransition] = useTransition()
  // «Не состоялись» по своим колонкам: для активных Rejected-сделок нужен их
  // исходный этап (не сам Rejected) — см. listRejectedDealOrigins в
  // src/server/deals.ts (читает журнал deal_activity). Отменённые сделки
  // сюда не входят — их funnelStageId уже корректный, доп. данные не нужны.
  const [rejectedOrigins, setRejectedOrigins] = useState<
    Record<string, string>
  >({})
  const loadRejectedOrigins = () => {
    fetch("/api/deals?rejectedOrigins=1")
      .then((r) => r.json())
      .then((d) => setRejectedOrigins(d.origins ?? {}))
      .catch(() => {})
  }
  useEffect(() => {
    loadRejectedOrigins()
  }, [])

  const refresh = () => {
    router.refresh()
    refetchBoard()
    loadRejectedOrigins()
  }

  // Агент авто-применил переводы во время загрузки интела — подтягиваем свежие
  // стадии сделок (сервер-компонент перечитает deals). Повторный фетч интела
  // вернёт appliedMoves = 0 (гвард + resolved-set), так что цикла нет.
  useEffect(() => {
    if (board.appliedMoves > 0) {
      toast(
        `Агент перевёл сделки: ${board.appliedMoves} — помечены на карточках`,
      )
      router.refresh()
    }
  }, [board.appliedMoves, router])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  // Владелец + клиенты, БЕЗ фильтра «Перевёл агент» — источник для «Не
  // состоялись» (см. lostDeals ниже): этот раздел управляется отдельным
  // чекбоксом showLostDeals и не должен пропадать при включении agentMovedOnly
  // (иначе «Не состоялись» включён, но карточки исчезают — баг, о котором
  // сообщил пользователь).
  const filteredBase = useMemo(() => {
    const clientSet = new Set(clientFilters)
    return filterByOwner(deals, filter, currentUserId).filter(
      (d) => clientSet.size === 0 || clientSet.has(d.clientId),
    )
  }, [deals, filter, currentUserId, clientFilters])

  const filtered = useMemo(
    () =>
      filteredBase.filter((d) => !agentMovedOnly || d.lastMovedBy === "agent"),
    [filteredBase, agentMovedOnly],
  )

  const activeDeals = useMemo(
    () => filtered.filter((d) => d.status === "active"),
    [filtered],
  )

  // Обычные колонки — только активные сделки. Отменённые = не состоялись →
  // показываются КАРТОЧКАМИ в финальной колонке «Закрытие» (см. terminalCards).
  // Удалённые (ошибки ввода) в обычных колонках не показываются никогда.
  const boardDeals = useMemo(
    () => filtered.filter((d) => d.status === "active"),
    [filtered],
  )

  // Терминальные итоги (UX №4/№5/№6): «Выиграно» = активные на стадии Closed;
  // «Проиграно» = активные на стадии Rejected + все отменённые (cancelled).
  // Deleted в итоги не входят. Считаем из filtered (агрегат виден всегда).
  const wonDeals = useMemo(
    () =>
      filtered.filter(
        (d) => d.status === "active" && d.funnelStageName === "Closed",
      ),
    [filtered],
  )
  const lostDeals = useMemo(
    () =>
      filteredBase.filter(
        (d) =>
          d.status === "cancelled" ||
          (d.status === "active" && d.funnelStageName === "Rejected"),
      ),
    [filteredBase],
  )

  // «Не состоялись» по своим колонкам (не одной кучей в «Закрытие»): каждая
  // проигранная/отменённая сделка показывается под разделителем в ТОЙ
  // обычной колонке, с которой её закрыли. cancelled → funnelStageId уже
  // корректный (setDealStatus его не трогает). Активная Rejected → исходный
  // этап из rejectedOrigins (журнал deal_activity). Сделки без derivable-
  // происхождения (старые, до журнала) остаются в lostNoOrigin — fallback,
  // показываются в колонке «Закрытие» под тем же разделителем, чтобы не
  // потеряться молча.
  const flowStageIds = useMemo(
    () => new Set(stages.filter((s) => !isTerminalStage(s.name)).map((s) => s.id)),
    [stages],
  )
  const { lostByStage, lostNoOrigin } = useMemo(() => {
    const byStage: Record<string, DealRow[]> = {}
    const noOrigin: DealRow[] = []
    for (const d of lostDeals) {
      const originStageId =
        d.status === "cancelled" ? d.funnelStageId : rejectedOrigins[d.id]
      if (originStageId && flowStageIds.has(originStageId)) {
        ;(byStage[originStageId] ??= []).push(d)
      } else {
        noOrigin.push(d)
      }
    }
    return { lostByStage: byStage, lostNoOrigin: noOrigin }
  }, [lostDeals, rejectedOrigins, flowStageIds])

  // Карточки финальной колонки = выигранные (active Closed) + проигранные БЕЗ
  // derivable-происхождения (см. lostNoOrigin выше) — остальные проигранные
  // теперь показываются в своих обычных колонках. Заголовок колонки
  // (Trophy/Trash) считает ВСЕ lostDeals по орге, а не только lostNoOrigin —
  // это общий тотал, независимо от того, где физически лежат карточки.
  const terminalCards = useMemo(
    () => sortTerminalCards([...wonDeals, ...lostNoOrigin], finalSort),
    [wonDeals, lostNoOrigin, finalSort],
  )

  const flowStages = useMemo(
    () => stages.filter((s) => !isTerminalStage(s.name)),
    [stages],
  )
  const terminalStages = stages.filter((s) => isTerminalStage(s.name))
  const closedStage = useMemo(
    () => stages.find((s) => s.name === "Closed") ?? null,
    [stages],
  )
  const rejectedStage = useMemo(
    () => stages.find((s) => s.name === "Rejected") ?? null,
    [stages],
  )

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

  // Все колонки доски свёрнуты (включая финальную) → кнопка над доской
  // переключается на «Развернуть все колонки».
  const allCollapsed =
    store.columns.length > 0 &&
    store.columns.every((c) => store.collapsed[c.stage.id]) &&
    (terminalStages.length === 0 || finalCollapsed)

  // «Свернуть/развернуть все» — и обычные колонки (store), и финальную.
  const setAllCollapsed = (value: boolean) => {
    store.setAllCollapsed(value)
    setFinalCollapsed(value)
  }

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
    const toStage = stages.find((s) => s.id === toStageId)

    // Дроп в финальную колонку (пустая зона = sentinel `__final__`) ИЛИ на
    // терминальную карточку (реальный id стадии Closed/Rejected) → диалог исхода:
    // Выиграно → Closed, Проиграно → Rejected (см. confirmOutcome).
    if (toStageId === FINAL_DROP_ID || (toStage && isTerminalStage(toStage.name))) {
      if (moving.status !== "active") return // отменённые/удалённые не трогаем
      // Брошено на карточку той же терминальной стадии — переупорядочивания в
      // финальной колонке нет, диалог не дёргаем.
      if (
        toStage &&
        isTerminalStage(toStage.name) &&
        moving.funnelStageId === toStageId
      )
        return
      // Дроп на свёрнутый рельс — разворачиваем, чтобы результат был виден.
      if (finalCollapsed) setFinalCollapsed(false)
      const fromStage = stages.find((s) => s.id === fromStageId)
      setPendingOutcome({
        dealId: moving.id,
        dealName: moving.name,
        fromLabel: dealStageLabel(fromStage?.name ?? ""),
      })
      return
    }

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

    // Смена стадии (нетерминальная цель) → наш диалог с заметкой-основанием.
    if (!toStage) return
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

  // Смена этапа из выбора в дровере (Select) — заводит ТОТ ЖЕ
  // confirm/reason-диалог, что и перетаскивание карточки (см. handleDragEnd
  // выше): обязательное обоснование для обратного перевода, подтверждение
  // исхода при переводе в терминальную стадию (Closed/Rejected). Дровер
  // больше не пишет в /api/deals напрямую в обход этих диалогов.
  function requestStageChange(deal: DealRow, toStageId: string) {
    if (deal.status !== "active") return
    if (toStageId === deal.funnelStageId) return
    const toStage = stages.find((s) => s.id === toStageId)
    if (!toStage) return
    const fromStage = stages.find((s) => s.id === deal.funnelStageId)

    if (isTerminalStage(toStage.name)) {
      if (finalCollapsed) setFinalCollapsed(false)
      setPendingOutcome({
        dealId: deal.id,
        dealName: deal.name,
        fromLabel: dealStageLabel(fromStage?.name ?? ""),
      })
      return
    }

    if (store.collapsed[toStageId]) store.expand(toStageId)
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
    // Короткая запись по умолчанию, если комментарий пуст — перевод без
    // комментария раньше затирал deal.changes на null (карточка/дровер
    // пустели). Обратный перевод: причина обязательна в диалоге и ВСЕГДА
    // попадает в журнал (historyNote → Хронология/Лента решений) — только
    // карточечное deal.changes (note) её не показывает (дежурная запись
    // вместо неё), чтобы не путать с реальным текущим состоянием сделки.
    const stamp = `Переведено: ${move.toLabel}`
    const realNote = note.trim() || stamp
    const noteToSend = move.direction === "back" ? stamp : realNote
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: move.dealId,
            move: true,
            funnelStageId: move.toStageId,
            note: noteToSend,
            historyNote: realNote,
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

  // Подтверждение исхода из диалога финальной колонки: Выиграно → Closed,
  // Проиграно → Rejected. Идёт по тому же move-пути (moveDealStage, actor='user'
  // + запись в ленту решений), append в конец целевой терминальной стадии.
  function confirmOutcome(result: "won" | "lost", note: string) {
    if (!pendingOutcome) return
    const stage = result === "won" ? closedStage : rejectedStage
    if (!stage) {
      toast.error("Терминальная стадия не найдена в воронке")
      return
    }
    const outcome = pendingOutcome
    const targetCards = boardDeals.filter(
      (d) => d.funnelStageId === stage.id && d.id !== outcome.dealId,
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
    const label = result === "won" ? "Выиграно" : "Не состоялось"
    // Короткая запись по умолчанию, если комментарий пуст — см. confirmMove.
    const noteToSend = note.trim() || `Переведено: ${label}`
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: outcome.dealId,
            move: true,
            funnelStageId: stage.id,
            note: noteToSend,
            historyNote: noteToSend,
            position,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось закрыть сделку")
          return
        }
        toast.success(`Сделка закрыта: ${label}`)
        setPendingOutcome(null)
        refresh()
      } catch {
        toast.error("Не удалось закрыть сделку")
      }
    })
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Полная ширина, как у остальных страниц (стиль Аналитики). */}
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-4 flex-wrap">
              <h1 className="text-xl font-medium">Сделки</h1>
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
            <div className="flex items-center gap-2">
              <AiChatTrigger />
              <GlobalSearch />
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap rounded-lg border bg-card shadow-sm p-3">
            {/* Сегментед-контрол Все/Мои (single-select, на базе Tabs). */}
            <Tabs
              value={filter}
              onValueChange={(v) => setFilter(v as OwnerFilter)}
            >
              <TabsList>
                <TabsTrigger value="all">Все</TabsTrigger>
                <TabsTrigger value="mine">Мои</TabsTrigger>
              </TabsList>
            </Tabs>
            {/* Мультиселект-комбобокс клиентов (UX №17) — единственный фильтр
                вместо поиска по названию + селекта: клик открывает список всех
                клиентов, выбор чекбоксами, фильтрация вводом. */}
            <ClientMultiSelect
              values={clientFilters}
              options={clientOptions}
              onToggle={(id) =>
                setClientFilters((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id],
                )
              }
              onClear={() => setClientFilters([])}
            />
            {/* «Перевёл агент» — тот же термин, что в бейдже карточки (UX №19). */}
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Checkbox
                checked={agentMovedOnly}
                onCheckedChange={(v) => setAgentMovedOnly(Boolean(v))}
              />
              Перевёл агент
            </label>
            {/* Чекбокс «Отменённые» убран (UX №6): отменённые приравнены к
                не состоявшимся и живут в терминальной колонке (см. § ниже).
                «Удалённые» тоже убран — удалённые сделки (ошибки ввода) на
                доске больше не показываются вовсе. Вместо него — «Не
                состоялись»: раскрывает проигранные карточки в колонке
                «Закрытие» под разделителем (по умолчанию скрыты). */}
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Checkbox
                checked={showLostDeals}
                onCheckedChange={(v) => setShowLostDeals(Boolean(v))}
              />
              Не состоялись
            </label>
            {/* Перенесены сюда со строки заголовка, чтобы освободить её для
                глобального поиска (справа от заголовка). */}
            <DiscoverDealsDialog
              onDealsGenerated={router.refresh}
              trigger={
                <Button size="sm" variant="secondary">
                  <Sparkles className="h-4 w-4 mr-1" />
                  Найти в источниках
                </Button>
              }
            />
            <Button
              size="sm"
              variant={feedOpen ? "default" : "outline"}
              onClick={() => setFeedOpen((v) => !v)}
            >
              <ListTree className="h-4 w-4 mr-1" />
              Лента решений
            </Button>
            <DealEditDialog
              // router.refresh() один сам по себе обновляет только серверный
              // список сделок (карточка сделки появлялась сразу) — интел
              // борда (tasksByDeal и т.п., useBoardIntel) — отдельный
              // клиентский фетч, который router.refresh() не трогает.
              // Из-за этого задача, созданная сразу вместе со сделкой
              // (см. pendingTaskDeal в form-deal-edit.tsx — тот же onSuccess
              // используется и для неё), не появлялась на карточке без
              // ручного обновления страницы. `refresh` делает оба шага.
              onSuccess={refresh}
              trigger={
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Новая сделка
                </Button>
              }
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="ml-auto"
                    aria-label={
                      allCollapsed
                        ? "Развернуть все колонки"
                        : "Свернуть все колонки"
                    }
                    onClick={() => setAllCollapsed(!allCollapsed)}
                  >
                    {allCollapsed ? (
                      <ChevronsLeftRight className="h-4 w-4" />
                    ) : (
                      <ChevronsRightLeft className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {allCollapsed
                    ? "Развернуть все колонки"
                    : "Свернуть все колонки"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
            // Каждая колонка скроллится по вертикали НЕЗАВИСИМО (см. column.tsx:
            // заголовок фиксирован, overflow-y на зоне карточек). Контейнер
            // даёт только горизонтальный скролл; колонки растянуты по высоте
            // (без items-start), чтобы зона скролла была во весь экран.
            className="flex-1 min-h-0 flex gap-2 overflow-x-auto scrollbar-none px-4 pb-4"
          >
            {store.columns.map((column) => {
              return store.collapsed[column.stage.id] ? (
                <Rail
                  key={column.stage.id}
                  stage={column.stage}
                  count={column.cards.length}
                  amount={aggregateByCurrency(
                    column.cards.map((d) => ({
                      amount: dealAmount(d.value),
                      currency: d.currency,
                    })),
                  )}
                  onExpand={() => store.expand(column.stage.id)}
                />
              ) : (
                <Column
                  key={column.stage.id}
                  column={column}
                  lostCards={lostByStage[column.stage.id] ?? []}
                  showLost={showLostDeals}
                  intelById={board.intel}
                  tasksByDeal={board.tasksByDeal}
                  intelLoaded={!boardLoading}
                  onOpen={(d) => {
                    if (justDraggedRef.current) return
                    setOpenDealId(d.id)
                    setDrawerOpen(true)
                  }}
                  onCollapse={() => store.toggleCollapse(column.stage.id)}
                  onSortChange={(mode) => store.setSort(column.stage.id, mode)}
                />
              )
            })}

            {terminalStages.length > 0 && (
              // Финальная колонка «Закрытие» — теперь полноценная колонка: drop-цель
              // для закрытия сделок (диалог исхода), статистика Выиграно/Проиграно
              // в заголовке, карточки в теле, свой набор сортировок.
              <TerminalColumn
                cards={terminalCards}
                wonDeals={wonDeals}
                lostDeals={lostDeals}
                showLost={showLostDeals}
                mode={finalSort}
                onSortChange={setFinalSort}
                collapsed={finalCollapsed}
                onCollapse={() => setFinalCollapsed(true)}
                onExpand={() => setFinalCollapsed(false)}
                intelById={board.intel}
                tasksByDeal={board.tasksByDeal}
                intelLoaded={!boardLoading}
                onOpen={(d) => {
                  if (justDraggedRef.current) return
                  setOpenDealId(d.id)
                  setDrawerOpen(true)
                }}
              />
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
      <DealOutcomeDialog
        outcome={pendingOutcome}
        pending={isPending}
        onConfirm={confirmOutcome}
        onCancel={() => setPendingOutcome(null)}
      />
      <DealDetailDrawer
        deal={openDeal}
        stages={stages}
        clientOptions={clientOptions}
        currentUserId={currentUserId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onChanged={refresh}
        onRequestStageChange={requestStageChange}
      />
      <DealDecisionFeed
        open={feedOpen}
        onOpenChange={setFeedOpen}
        events={board.feed}
      />
    </div>
  )
}
