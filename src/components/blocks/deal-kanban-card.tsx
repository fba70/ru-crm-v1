"use client"

import { useState } from "react"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Pencil,
  AlertTriangle,
  Clock,
  Send,
  Mail,
  Sparkles,
  Repeat,
  Lock,
  ChevronLeft,
  ChevronRight,
  Trophy,
  Trash2,
  type LucideIcon,
} from "lucide-react"
import type { DealRow } from "@/app/api/deals/route"
import type { DealIntel, IntelBadge } from "@/server/deals-mock"
import type { DealTaskInfo } from "@/hooks/use-board-intel"
import { mockAtRisk, mockRiskReason } from "@/lib/deal-mocks"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { formatAmount } from "@/lib/deal-board"

// Мок-бейджи (из /api/deals/intel) несут имя lucide-иконки в kebab-case.
const BADGE_ICON: Record<string, LucideIcon> = {
  send: Send,
  mail: Mail,
  sparkles: Sparkles,
  repeat: Repeat,
  lock: Lock,
}

// Бейджи в ОБЕИХ темах — три оттенка палитры (по .mtag лендинга):
// голубой = происхождение (TG/письмо), красный warn = внимание (остывание),
// фиолетовый = действия агента. Никаких sky/amber вне палитры.
const BADGE_CLASS: Record<IntelBadge["kind"], string> = {
  source:
    "bg-[#669BBC]/20 text-[#2F5D77] dark:bg-[#669BBC]/25 dark:text-[#9FC4DC]",
  ai: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  auto: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  lock: "bg-muted text-muted-foreground",
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()


// Заголовок: компания (клиент) сверху, продукт/проект (название сделки) — строкой
// ниже. Если клиент не привязан, название сделки само становится заголовком.
function DealTitle({ deal }: { deal: DealRow }) {
  const company = deal.clientName ?? deal.name
  const product = deal.clientName ? deal.name : null
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium leading-snug truncate">{company}</div>
      {product && (
        // Две строки (UX №8) — в одну описание не вмещается. Дедуп названия
        // компании в описании — на стороне генератора текста (бэк-вопрос).
        <div className="text-xs text-muted-foreground leading-snug line-clamp-2">
          {product}
        </div>
      )}
    </div>
  )
}

// Сумма и имя менеджера — в две строки (сумма сверху, менеджер под ней).
function DealMetaLine({ deal }: { deal: DealRow }) {
  const amount = formatAmount(deal.value, deal.currency)
  if (!amount && !deal.userName) return null
  return (
    <div className="text-sm leading-tight">
      {amount && <div className="font-semibold">{amount}</div>}
      {deal.userName && (
        <div className="text-xs text-muted-foreground">{deal.userName}</div>
      )}
    </div>
  )
}

export function DealKanbanCard({
  deal,
  onChanged,
  onOpen,
  tasks = [],
  intel,
  intelLoaded = false,
}: {
  deal: DealRow
  onChanged: () => void
  onOpen: (deal: DealRow) => void
  // Все задачи сделки (по createdAt desc). Карточка листает их шевронами.
  tasks?: DealTaskInfo[]
  // Мок-интел по сделке (остывание/бейджи). undefined до загрузки.
  intel?: DealIntel
  // Загружены ли данные доски (next-step/intel). До загрузки НЕ показываем
  // инвариант — иначе ложная «красная» вспышка на первом рендере.
  intelLoaded?: boolean
}) {
  // Индекс листаемой задачи (0 = самая свежая). Клампится к длине списка.
  const [taskIdx, setTaskIdx] = useState(0)
  const taskCount = tasks.length
  const safeIdx = taskCount ? Math.min(taskIdx, taskCount - 1) : 0
  const currentTask = tasks[safeIdx] ?? null
  // Перетаскиваются ВСЕ активные сделки — человек вправе двигать как хочет
  // (в т.ч. переигрывать агентские переводы). Заблокированы только
  // отменённые/удалённые: их статус терминальный, перенос не имеет смысла.
  const isActive = deal.status === "active"
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: !isActive,
  })
  // Карточка ещё и droppable — для точной вставки before/after в колонке
  // (collisionDetection в board.tsx предпочитает card-цели колоночной).
  // Drag остаётся на всей карточке; клик-vs-drag разведён justDraggedRef в board.
  const { setNodeRef: setDropRef } = useDroppable({
    id: `card:${deal.id}`,
    data: { type: "card" as const, stageId: deal.funnelStageId, dealId: deal.id },
  })

  // Исход в финальной колонке: выиграна (Closed) / проиграна (Rejected). Только
  // активные — отменённые/удалённые несут свои бейджи «Отменена»/«Удалена».
  const isWon = isActive && deal.funnelStageName === "Closed"
  const isLost = isActive && deal.funnelStageName === "Rejected"
  const isTerminal = isWon || isLost

  // Инсайты «остывание»/«риск» на закрытых карточках не показываем — сделка
  // уже завершена, тревожные бейджи там бессмысленны.
  const isStale = Boolean(intel?.isStale) && !isTerminal
  // На карточке НЕ показываем: бейдж происхождения (kind==='source', UX №9 —
  // он в подробностях) и мок-бейдж «авто-задача по правилу» (kind==='auto') —
  // он противоречил реальному блоку задач («Задач нет» рядом с «авто-задача»).
  const badges = (intel?.badges ?? []).filter(
    (b) => b.kind !== "source" && b.kind !== "auto",
  )
  // Метка «перевёл агент»: последний перевод стадии сделал агент (авто-
  // применённое предложение или LLM-discovery) и человек его ещё не
  // пересматривал. Причина перевода (changes) — в поповере бейджа.
  const movedByAgent = deal.lastMovedBy === "agent"
  // Инсайт «риск проигрыша» (UX №12, мок). isStale («долго висит») уже есть.
  // На закрытых карточках риск не показываем (см. isStale выше).
  const atRisk = isActive && !isTerminal && mockAtRisk(deal.id)
  const hasBadgeRow = badges.length > 0 || isStale || movedByAgent || atRisk

  // Графитовый фон + светлый текст для «негативных» карточек: удалённые (trash)
  // И проигранные (проиграно == отменено == активная Rejected) — все читаются
  // единообразно тёмными. Выигранные и обычные — обычная светлая поверхность.
  const isGraphite =
    deal.status === "deleted" || deal.status === "cancelled" || isLost
  const surfaceClass = isGraphite
    ? "bg-[#26262b] text-zinc-100 border-[#3c3c43]"
    : "bg-card border-muted hover:border-[#669BBC]/40 hover:bg-accent/20 dark:bg-[#FDF0D5]/[0.045] dark:border-[#FDF0D5]/10 dark:shadow-none dark:hover:border-[#669BBC]/25 dark:hover:bg-[#FDF0D5]/[0.06]"

  return (
    <Card
      ref={(node) => {
        setNodeRef(node)
        setDropRef(node)
      }}
      data-deal-id={deal.id}
      {...attributes}
      {...listeners}
      className={`group p-3 space-y-1 transition-[transform,border-color,background-color] duration-200 hover:-translate-y-[3px] ${surfaceClass} ${
        isActive ? "cursor-grab active:cursor-grabbing" : "opacity-60"
      } ${isDragging ? "opacity-40" : ""}`}
      aria-label={`Открыть сделку: ${deal.clientName ?? deal.name}`}
      onClick={() => onOpen(deal)}
      onKeyDown={(e) => {
        // Клавиатурная активация: карточка получает role=button/tabIndex от
        // dnd-kit, поэтому Enter/Space должны открывать drawer. Реагируем только
        // на фокус самой карточки, не вложенных кнопок.
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(deal)
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <DealTitle deal={deal} />
        <DealEditDialog
          mode="edit"
          deal={deal}
          onSuccess={onChanged}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              aria-label="Редактировать сделку"
              onPointerDown={stop}
              onClick={stop}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          }
        />
      </div>

      {isWon && (
        <Badge
          variant="secondary"
          className="gap-1 bg-[#1F7A4D]/15 text-[#1F7A4D] dark:text-[#5BD69A]"
        >
          <Trophy className="h-3 w-3" />
          Выиграно
        </Badge>
      )}
      {isLost && (
        <Badge variant="secondary" className="gap-1 bg-white/10 text-zinc-200">
          <Trash2 className="h-3 w-3" />
          Проиграно
        </Badge>
      )}
      {deal.status === "cancelled" && (
        <Badge variant="secondary" className="bg-white/10 text-zinc-200">
          Отменена
        </Badge>
      )}
      {deal.status === "deleted" && (
        <Badge variant="secondary" className="bg-red-400/20 text-red-200">
          Удалена
        </Badge>
      )}

      <DealMetaLine deal={deal} />

      {/* Последнее изменение (UX №10) — целиком, в отдельной плашке с чётким
          фоном+рамкой (полупрозрачная карточка «съедала» muted/50), без иконки. */}
      {isActive && deal.changes && (
        <div className="rounded-md border border-border bg-muted p-2 text-xs text-foreground/80">
          {deal.changes}
        </div>
      )}

      {/* Задачи: заголовок СНАРУЖИ плашки. Одна задача → «Задача»; несколько →
          «Задачи» + счётчик, а справа шевроны для листания задач прямо на
          карточке. Внутри плашки — имя + исполнитель (бейджи не показываем —
          вся детализация в подробностях). Нет задач → «Задач нет» оранжевым. */}
      {isActive &&
        (currentTask ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {taskCount > 1 ? `Задачи ${taskCount}` : "Задача"}
              </div>
              {taskCount > 1 && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4"
                    aria-label="Предыдущая задача"
                    disabled={safeIdx === 0}
                    onPointerDown={stop}
                    onClick={(e) => {
                      stop(e)
                      setTaskIdx((i) => Math.max(0, i - 1))
                    }}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4"
                    aria-label="Следующая задача"
                    disabled={safeIdx >= taskCount - 1}
                    onPointerDown={stop}
                    onClick={(e) => {
                      stop(e)
                      setTaskIdx((i) => Math.min(taskCount - 1, i + 1))
                    }}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
            <div className="rounded-md border border-border bg-muted p-2 space-y-1">
              <div className="truncate text-xs text-foreground">
                {currentTask.name}
              </div>
              {currentTask.assigneeName && (
                <div className="truncate text-[11px] text-muted-foreground">
                  Исполнитель: {currentTask.assigneeName}
                </div>
              )}
            </div>
          </div>
        ) : (
          intelLoaded && (
            <div className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Задач нет
            </div>
          )
        ))}

      {hasBadgeRow && (
        <div className="flex flex-wrap gap-1">
          {badges.map((b, i) => {
            const Icon = BADGE_ICON[b.icon]
            return (
              <Badge
                key={i}
                variant="secondary"
                className={`gap-1 ${BADGE_CLASS[b.kind]}`}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {b.text}
              </Badge>
            )
          })}
          {atRisk && (
            // Наведение на бейдж — тултип с объяснением, почему риск (мок).
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex cursor-help"
                  aria-label="Почему риск проигрыша"
                  onPointerDown={stop}
                  onClick={stop}
                >
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-[#C1121F]/10 text-[#A31018] dark:bg-[#C1121F]/15 dark:text-[#FF8F96]"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    риск проигрыша
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent align="start" className="max-w-xs text-xs">
                {mockRiskReason(deal.id)}
              </TooltipContent>
            </Tooltip>
          )}
          {isStale && intel && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onPointerDown={stop}
                  onClick={stop}
                  aria-label="Сделка остывает"
                >
                  <Badge
                    variant="secondary"
                    className="gap-1 cursor-pointer bg-[#C1121F]/10 text-[#A31018] dark:bg-[#C1121F]/15 dark:text-[#FF8F96]"
                  >
                    <Clock className="h-3 w-3" />
                    {intel.staleDays} дн без активности
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-72 text-sm space-y-2"
                onClick={stop}
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Сделка остывает
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Без активности</span>
                  <span className="font-medium">{intel.staleDays} дн</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Норма стадии</span>
                  <span>{intel.norm} дн</span>
                </div>
                {/* TODO(backend): здесь агент должен подготавливать черновик
                    follow-up в канал последнего контакта. */}
                <div className="text-xs text-muted-foreground pt-1 border-t">
                  Агент подготовил черновик follow-up в канал последнего контакта.
                </div>
              </PopoverContent>
            </Popover>
          )}
          {movedByAgent && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onPointerDown={stop}
                  onClick={stop}
                  aria-label="Стадию перевёл агент"
                >
                  <Badge
                    variant="secondary"
                    className="gap-1 cursor-pointer bg-violet-500/15 text-violet-600 dark:text-violet-300"
                  >
                    <Sparkles className="h-3 w-3" />
                    перевёл агент
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-72 text-sm space-y-2"
                onClick={stop}
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Стадию перевёл агент
                </div>
                <div>
                  {deal.changes ??
                    deal.reasoning ??
                    "Автоматический перевод по сигналу из источников."}
                </div>
                <div className="text-xs text-muted-foreground pt-1 border-t">
                  Не согласны — просто перетащите карточку на нужную стадию.
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </Card>
  )
}

// Превью карточки под курсором при перетаскивании (DragOverlay).
export function DealKanbanCardOverlay({ deal }: { deal: DealRow }) {
  return (
    <Card className="w-64 p-3 space-y-2 bg-card border-muted shadow-xl rotate-2 cursor-grabbing">
      <DealTitle deal={deal} />
      <DealMetaLine deal={deal} />
    </Card>
  )
}
