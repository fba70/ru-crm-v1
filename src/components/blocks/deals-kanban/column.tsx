"use client"

import { useDroppable } from "@dnd-kit/core"
import { ArrowDownUp, PanelLeftClose, Flag } from "lucide-react"
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
  dealAmount,
} from "@/lib/deal-board"
import type { DealRow } from "@/app/api/deals/route"
import type { DealIntel, DealProposal } from "@/server/deals-mock"
import type { NextStep } from "@/hooks/use-board-intel"
import { DealKanbanCard } from "@/components/blocks/deal-kanban-card"
import { DealProposalGhost } from "@/components/blocks/deal-proposal-ghost"
import {
  SORT_LABEL,
  SORT_MODES,
  type BoardColumn,
  type SortMode,
} from "./store"

// Гибрид: хром fba70 (дропдаун сортировки + кнопка сворачивания) поверх нашей
// статистики стадии (count / сумма / взвеш. / коммитмент) и нашего контента
// (ghost-предложения агента + DealKanbanCard). Колонка — droppable `col:<id>`
// с data.stageId для card→column collision в board.tsx.
export function Column({
  column,
  ghosts,
  intelById,
  nextStepByDeal,
  dealsWithProposal,
  commitments,
  pending,
  intelLoaded,
  hideDeals,
  onChanged,
  onOpen,
  onAccept,
  onReject,
  onCollapse,
  onSortChange,
}: {
  column: BoardColumn
  ghosts: DealProposal[]
  intelById: Record<string, DealIntel>
  nextStepByDeal: Record<string, NextStep | null>
  dealsWithProposal: Set<string>
  commitments: string[]
  pending: boolean
  intelLoaded: boolean
  // Режим «только предложения»: обычные карточки скрыты, видны только ghost.
  hideDeals: boolean
  onChanged: () => void
  onOpen: (deal: DealRow) => void
  onAccept: (id: string) => void
  onReject: (id: string, reason: string) => void
  onCollapse: () => void
  onSortChange: (mode: SortMode) => void
}) {
  const { stage, mode, cards } = column
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${stage.id}`,
    data: { type: "column" as const, stageId: stage.id },
  })
  const colorClass = STAGE_COLOR[stage.name] ?? STAGE_DEFAULT
  const firstCommit = commitments[0]

  return (
    <div className="w-64 shrink-0 flex flex-col gap-2">
      <div className={`rounded-lg border p-2.5 ${colorClass}`}>
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 text-sm font-medium">
              <span className="truncate">{dealStageLabel(stage.name)}</span>
              <span className="text-xs opacity-70 shrink-0">
                {Math.round(stage.closureProbability * 100)}%
              </span>
            </div>
            <div className="text-xs opacity-80 mt-0.5">
              {cards.length} ·{" "}
              {aggregateByCurrency(
                cards.map((d) => ({
                  amount: dealAmount(d.value),
                  currency: d.currency,
                })),
              )}{" "}
              · взвеш.{" "}
              {aggregateByCurrency(
                cards.map((d) => ({
                  amount: dealAmount(d.value) * stage.closureProbability,
                  currency: d.currency,
                })),
              )}
            </div>
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
        {firstCommit && (
          <div className="flex items-start gap-1.5 text-xs opacity-70 mt-1.5 pt-1.5 border-t border-black/5 dark:border-white/10">
            <Flag className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="line-clamp-2">
              {firstCommit.toLowerCase()}
              {commitments.length > 1 ? ` +${commitments.length - 1}` : ""}
            </span>
          </div>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 min-h-24 rounded-lg transition-colors ${
          isOver ? "outline outline-2 outline-dashed outline-primary" : ""
        }`}
      >
        {ghosts.map((p) => (
          <div key={p.id} data-proposal-ghost>
            <DealProposalGhost
              proposal={p}
              pending={pending}
              onAccept={onAccept}
              onReject={onReject}
            />
          </div>
        ))}
        {!hideDeals &&
          cards.map((d) => (
            <DealKanbanCard
              key={d.id}
              deal={d}
              onChanged={onChanged}
              onOpen={onOpen}
              nextStep={nextStepByDeal[d.id] ?? null}
              intel={intelById[d.id]}
              hasProposal={dealsWithProposal.has(d.id)}
              intelLoaded={intelLoaded}
            />
          ))}
      </div>
    </div>
  )
}
