"use client"

import { useDraggable, useDroppable } from "@dnd-kit/core"
import { GripVertical } from "lucide-react"
import { DealCard } from "@/components/blocks/deal-card"
import type { DealRow, DealFunnelStageOption } from "@/app/api/deals/route"

// A deal card that is BOTH draggable (the grip handle) and a droppable target
// (for precise before/after hit-testing). DealCard itself is untouched — the
// grip strip is added by the wrapper so the card's own controls (edit, the
// move-stage Select) stay fully interactive. Off-screen virtualized cards
// aren't rendered, so they aren't droppables — exactly why column-as-droppable
// + visible-card hit-testing survives virtualization.
export function KanbanCard({
  deal,
  stages,
  onChanged,
}: {
  deal: DealRow
  stages: DealFunnelStageOption[]
  onChanged: () => void
}) {
  const data = { type: "card" as const, stageId: deal.funnelStageId, dealId: deal.id }
  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({ id: deal.id, data })
  const { setNodeRef: setDropRef } = useDroppable({
    id: `card:${deal.id}`,
    data,
  })

  return (
    <div
      ref={setDropRef}
      className={isDragging ? "opacity-40" : undefined}
      data-deal-id={deal.id}
    >
      <div ref={setDragRef} className="relative">
        <button
          type="button"
          aria-label="Переместить сделку"
          className="absolute -left-1 top-1 z-10 flex h-6 w-5 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="pl-3">
          <DealCard deal={deal} stages={stages} onChanged={onChanged} />
        </div>
      </div>
    </div>
  )
}
