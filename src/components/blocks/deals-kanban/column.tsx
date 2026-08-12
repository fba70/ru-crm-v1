"use client"

import { useDroppable } from "@dnd-kit/core"
import { ArrowDownUp, PanelLeftClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { dealStageLabel } from "@/lib/deal-funnel"
import {
  STAGE_COLOR,
  STAGE_DEFAULT,
  aggregateByCurrency,
  aggregateByCurrencyCompact,
  dealAmount,
} from "@/lib/deal-board"
import type { DealRow } from "@/app/api/deals/route"
import type { DealIntel } from "@/server/deals-mock"
import type { DealTaskInfo } from "@/hooks/use-board-intel"
import { DealKanbanCard } from "@/components/blocks/deal-kanban-card"
import {
  SORT_LABEL,
  SORT_MODES,
  type BoardColumn,
  type SortMode,
} from "./store"

// Гибрид: хром fba70 (дропдаун сортировки + кнопка сворачивания) поверх нашей
// статистики стадии (count / сумма / взвеш.) и наших DealKanbanCard.
// Колонка — droppable `col:<id>` с data.stageId для card→column collision
// в board.tsx. Ghost-предложений агента больше нет — агент применяет переводы
// сам (см. /api/deals/proposals), карточка несёт бейдж «перевёл агент».
export function Column({
  column,
  intelById,
  tasksByDeal,
  intelLoaded,
  onChanged,
  onOpen,
  onCollapse,
  onSortChange,
}: {
  column: BoardColumn
  intelById: Record<string, DealIntel>
  tasksByDeal: Record<string, DealTaskInfo[]>
  intelLoaded: boolean
  onChanged: () => void
  onOpen: (deal: DealRow) => void
  onCollapse: () => void
  onSortChange: (mode: SortMode) => void
}) {
  const { stage, mode, cards } = column
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${stage.id}`,
    data: { type: "column" as const, stageId: stage.id },
  })
  const colorClass = STAGE_COLOR[stage.name] ?? STAGE_DEFAULT

  return (
    // Резиновая ширина: колонки делят ряд поровну — доска заполняет страницу
    // на широких экранах и вписывается в ширину панели на небольших. Ниже
    // 11rem не сжимаются — далее скролл. min-h-0: колонка растянута по высоте
    // контейнера, скроллится только её зона карточек (заголовок фиксирован).
    <div className="min-w-44 flex-1 min-h-0 flex flex-col gap-2">
      <div className={`shrink-0 rounded-lg border p-2.5 ${colorClass}`}>
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 text-sm font-medium">
              <span className="truncate">{dealStageLabel(stage.name)}</span>
              <span className="text-xs opacity-70 shrink-0">
                {Math.round(stage.closureProbability * 100)}%
              </span>
            </div>
            {/* Суммы сокращены (к/м, UX №1), точные значения — в тултипе. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="truncate text-xs opacity-80 mt-0.5 cursor-default">
                  {cards.length} ·{" "}
                  {aggregateByCurrencyCompact(
                    cards.map((d) => ({
                      amount: dealAmount(d.value),
                      currency: d.currency,
                    })),
                  )}{" "}
                  · взвеш.{" "}
                  {aggregateByCurrencyCompact(
                    cards.map((d) => ({
                      amount: dealAmount(d.value) * stage.closureProbability,
                      currency: d.currency,
                    })),
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent className="space-y-0.5">
                <div>
                  Сумма:{" "}
                  {aggregateByCurrency(
                    cards.map((d) => ({
                      amount: dealAmount(d.value),
                      currency: d.currency,
                    })),
                  )}
                </div>
                <div>
                  Взвешенно:{" "}
                  {aggregateByCurrency(
                    cards.map((d) => ({
                      amount: dealAmount(d.value) * stage.closureProbability,
                      currency: d.currency,
                    })),
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex shrink-0 items-center">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label="Сортировка"
                    >
                      <ArrowDownUp className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Сортировка: {SORT_LABEL[mode]}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Сортировка</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={mode}
                  onValueChange={(v) => onSortChange(v as SortMode)}
                >
                  {SORT_MODES.map((m) => (
                    <DropdownMenuRadioItem key={m} value={m}>
                      {SORT_LABEL[m]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={onCollapse}
                  aria-label={`Свернуть «${dealStageLabel(stage.name)}»`}
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Свернуть колонку</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 min-h-24 flex-1 overflow-y-auto scrollbar-none rounded-lg transition-colors ${
          isOver ? "outline outline-2 outline-dashed outline-primary" : ""
        }`}
      >
        {cards.map((d) => (
          <DealKanbanCard
            key={d.id}
            deal={d}
            onChanged={onChanged}
            onOpen={onOpen}
            tasks={tasksByDeal[d.id] ?? []}
            intel={intelById[d.id]}
            intelLoaded={intelLoaded}
          />
        ))}
      </div>
    </div>
  )
}
