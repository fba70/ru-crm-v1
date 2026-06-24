"use client"

import { useDroppable } from "@dnd-kit/core"
import { ChevronRight } from "lucide-react"
import { dealStageLabel } from "@/lib/deal-funnel"
import type { DealFunnelStageOption } from "@/app/api/deals/route"

// Collapsed column: a narrow vertical rail. Still a valid drop target — a card
// dropped here appends to the stage and the board auto-expands it (handled in
// board.tsx onDragEnd). Click anywhere to expand.
export function Rail({
  stage,
  count,
  onExpand,
}: {
  stage: DealFunnelStageOption
  count: number
  onExpand: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${stage.id}`,
    data: { type: "column" as const, stageId: stage.id },
  })

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full w-13 flex-shrink-0 flex-col items-center rounded-lg border bg-muted/30 transition-colors ${
        isOver ? "border-primary/60 bg-primary/5" : "border-border"
      }`}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Развернуть «${dealStageLabel(stage.name)}»`}
        className="flex h-full w-full flex-col items-center gap-2 py-2"
      >
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <span className="rounded-full bg-background px-1.5 text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
        <span
          className="mt-1 flex-1 text-sm font-medium text-muted-foreground"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {dealStageLabel(stage.name)}
        </span>
      </button>
    </div>
  )
}
