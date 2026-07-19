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

const BADGE_CLASS: Record<IntelBadge["kind"], string> = {
  source: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
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
  hasProposal = false,
  intelLoaded = false,
}: {
  deal: DealRow
  onChanged: () => void
  onOpen: (deal: DealRow) => void
  // Ближайшая открытая задача (реальные данные). null → инвариант нарушен.
  nextStep?: NextStep | null
  // Мок-интел по сделке (остывание/бейджи). undefined до загрузки.
  intel?: DealIntel
  // На сделку есть активное предложение агента → карточка приглушена, drag off.
  hasProposal?: boolean
  // Загружены ли данные доски (next-step/intel). До загрузки НЕ показываем
  // инвариант — иначе ложная «красная» вспышка на первом рендере.
  intelLoaded?: boolean
}) {
  // Неактивные (отменённые/удалённые) сделки и сделки с активным предложением
  // НЕ перетаскиваются — перевод только для активных без предложения.
  const isActive = deal.status === "active"
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: !isActive || hasProposal,
  })
  // Карточка ещё и droppable — для точной вставки before/after в колонке
  // (collisionDetection в board.tsx предпочитает card-цели колоночной).
  // Drag остаётся на всей карточке; клик-vs-drag разведён justDraggedRef в board.
  const { setNodeRef: setDropRef } = useDroppable({
    id: `card:${deal.id}`,
    data: { type: "card" as const, stageId: deal.funnelStageId, dealId: deal.id },
  })

  // Инвариант: у активной сделки без предложения обязан быть следующий шаг.
  // Показываем только после загрузки данных (иначе ложное срабатывание).
  const invariantBroken = intelLoaded && isActive && !hasProposal && !nextStep
  const isStale = Boolean(intel?.isStale)
  const badges = intel?.badges ?? []
  // Происхождение (reasoning/changes) на карточке НЕ показываем — детали
  // раскрываются в дравере сделки.
  const hasBadgeRow = badges.length > 0 || isStale || hasProposal

  return (
    <Card
      ref={(node) => {
        setNodeRef(node)
        setDropRef(node)
      }}
      data-deal-id={deal.id}
      {...attributes}
      {...listeners}
      className={`group p-3 space-y-2 bg-card border-muted transition-colors hover:border-primary/40 hover:bg-accent/30 ${
        isActive && !hasProposal ? "cursor-grab active:cursor-grabbing" : ""
      } ${!isActive || hasProposal ? "opacity-60" : ""} ${
        isDragging ? "opacity-40" : ""
      } ${invariantBroken ? "border-destructive/50" : ""}`}
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

      {/* Следующий шаг (реальная ближайшая задача) или нарушенный инвариант. */}
      {isActive &&
        (nextStep ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            <span className="truncate">
              {nextStep.name} · {formatShortDate(nextStep.dueDate)}
            </span>
          </div>
        ) : intelLoaded && !hasProposal ? (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>нет следующего шага — нарушен инвариант</span>
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
                    className="gap-1 cursor-pointer bg-amber-500/15 text-amber-600 dark:text-amber-300"
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
          {hasProposal && (
            <Badge
              variant="secondary"
              className="gap-1 bg-violet-500/15 text-violet-600 dark:text-violet-300"
            >
              <Sparkles className="h-3 w-3" />
              предложен перевод →
            </Badge>
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
