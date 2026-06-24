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
import type { DealFunnelStageOption } from "@/app/api/deals/route"
import { KanbanCard } from "./card"
import { SORT_LABEL, SORT_MODES, type BoardColumn, type SortMode } from "./store"

// Left accent bar per seeded stage (custom org stages fall through to neutral).
const STAGE_ACCENT: Record<string, string> = {
  Qualification: "bg-slate-400",
  Discovery: "bg-blue-400",
  Pilot: "bg-amber-400",
  Proposal: "bg-orange-400",
  Negotiations: "bg-indigo-400",
  Closed: "bg-emerald-400",
  Rejected: "bg-red-400",
}

export function Column({
  column,
  stages,
  onChanged,
  onCollapse,
  onSortChange,
}: {
  column: BoardColumn
  stages: DealFunnelStageOption[]
  onChanged: () => void
  onCollapse: () => void
  onSortChange: (mode: SortMode) => void
}) {
  const { stage, mode, cards } = column
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${stage.id}`,
    data: { type: "column" as const, stageId: stage.id },
  })

  // No internal vertical scroll / max-height for now (per product decision):
  // the column grows to fit all its cards and the page scrolls vertically.
  // Virtualization was removed with the scroll viewport — reinstate later via
  // a window-virtualizer if a column ever holds hundreds of cards.

  return (
    <div className="flex w-[max(320px,calc((100%-1.5rem)/3))] shrink-0 flex-col rounded-lg border bg-muted/20">
      <div className="flex items-center justify-between gap-1 border-b px-2 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-3.5 w-1 shrink-0 rounded-full ${STAGE_ACCENT[stage.name] ?? "bg-zinc-400"}`}
          />
          <span className="truncate text-sm font-semibold">
            {dealStageLabel(stage.name)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {cards.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Сортировка"
                  >
                    <ArrowDownUp className="h-4 w-4" />
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
                className="h-7 w-7"
                onClick={onCollapse}
                aria-label={`Свернуть «${dealStageLabel(stage.name)}»`}
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Свернуть колонку</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 px-2 py-2 transition-colors ${
          isOver ? "bg-primary/5" : ""
        }`}
      >
        {cards.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed text-center text-xs text-muted-foreground">
            Перетащите сюда сделку
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {cards.map((card) => (
              <KanbanCard
                key={card.id}
                deal={card}
                stages={stages}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
