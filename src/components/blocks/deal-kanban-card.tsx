"use client"

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
  Pencil,
  ArrowRight,
  AlertTriangle,
  Clock,
  Send,
  Mail,
  Sparkles,
  Repeat,
  Lock,
  type LucideIcon,
} from "lucide-react"
import type { DealRow } from "@/app/api/deals/route"
import type { DealIntel, IntelBadge } from "@/server/deals-mock"
import type { NextStep } from "@/hooks/use-board-intel"
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

// В тёмной теме source-бейджи и «остывание» повторяют .mtag лендинга:
// голубой blue-25 (#669BBC/25 + #9FC4DC) и красный warn (#C1121F/16 + #FF8F96).
const BADGE_CLASS: Record<IntelBadge["kind"], string> = {
  source:
    "bg-sky-500/15 text-sky-600 dark:bg-[#669BBC]/25 dark:text-[#9FC4DC]",
  ai: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  auto: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  lock: "bg-muted text-muted-foreground",
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

// Подсказка «нет след. шага» выключена, пока задачи не привязываются к сделкам
// из UI — включить обратно, когда форма задачи получит селектор сделки.
const SHOW_MISSING_NEXT_STEP = false

// Заголовок: компания (клиент) сверху, продукт/проект (название сделки) — строкой
// ниже. Если клиент не привязан, название сделки само становится заголовком.
function DealTitle({ deal }: { deal: DealRow }) {
  const company = deal.clientName ?? deal.name
  const product = deal.clientName ? deal.name : null
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium leading-snug truncate">{company}</div>
      {product && (
        <div className="text-xs text-muted-foreground leading-snug truncate">
          {product}
        </div>
      )}
    </div>
  )
}

// Сумма · ответственный — одной строкой.
function DealMetaLine({ deal }: { deal: DealRow }) {
  const amount = formatAmount(deal.value, deal.currency)
  if (!amount && !deal.userName) return null
  return (
    <div className="text-sm">
      {amount && <span className="font-semibold">{amount}</span>}
      {amount && deal.userName && (
        <span className="text-muted-foreground"> · </span>
      )}
      {deal.userName && (
        <span className="text-muted-foreground">{deal.userName}</span>
      )}
    </div>
  )
}

export function DealKanbanCard({
  deal,
  onChanged,
  onOpen,
  nextStep = null,
  intel,
  intelLoaded = false,
}: {
  deal: DealRow
  onChanged: () => void
  onOpen: (deal: DealRow) => void
  // Ближайшая открытая задача (реальные данные). null → инвариант нарушен.
  nextStep?: NextStep | null
  // Мок-интел по сделке (остывание/бейджи). undefined до загрузки.
  intel?: DealIntel
  // Загружены ли данные доски (next-step/intel). До загрузки НЕ показываем
  // инвариант — иначе ложная «красная» вспышка на первом рендере.
  intelLoaded?: boolean
}) {
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

  const isStale = Boolean(intel?.isStale)
  const badges = intel?.badges ?? []
  // Метка «перевёл агент»: последний перевод стадии сделал агент (авто-
  // применённое предложение или LLM-discovery) и человек его ещё не
  // пересматривал. Причина перевода (changes) — в поповере бейджа.
  const movedByAgent = deal.lastMovedBy === "agent"
  const hasBadgeRow = badges.length > 0 || isStale || movedByAgent

  return (
    <Card
      ref={(node) => {
        setNodeRef(node)
        setDropRef(node)
      }}
      data-deal-id={deal.id}
      {...attributes}
      {...listeners}
      className={`group p-3 space-y-2 transition-[transform,border-color,background-color] duration-200 hover:-translate-y-[3px] bg-card border-muted hover:border-[#669BBC]/40 hover:bg-accent/20 dark:bg-[#FDF0D5]/[0.045] dark:border-[#FDF0D5]/10 dark:shadow-none dark:hover:border-[#669BBC]/25 dark:hover:bg-[#FDF0D5]/[0.06] ${
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

      {deal.status === "cancelled" && (
        <Badge
          variant="secondary"
          className="bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"
        >
          Отменена
        </Badge>
      )}
      {deal.status === "deleted" && (
        <Badge
          variant="secondary"
          className="bg-red-500/15 text-red-600 dark:text-red-300"
        >
          Удалена
        </Badge>
      )}

      <DealMetaLine deal={deal} />

      {/* Следующий шаг = ближайшая открытая задача сделки. Подсказка об
          отсутствии шага СКРЫТА (SHOW_MISSING_NEXT_STEP), пока задачу нельзя
          привязать к сделке из UI (нет селектора сделки в форме задачи) —
          иначе она горела бы на каждой карточке. */}
      {isActive &&
        (nextStep ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            <span className="truncate">
              {nextStep.name} · {formatShortDate(nextStep.dueDate)}
            </span>
          </div>
        ) : intelLoaded && SHOW_MISSING_NEXT_STEP ? (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>нет след. шага</span>
          </div>
        ) : null)}

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
                    className="gap-1 cursor-pointer bg-amber-500/15 text-amber-600 dark:bg-[#C1121F]/15 dark:text-[#FF8F96]"
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
