"use client"

import { useState } from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Announcements,
} from "@dnd-kit/core"
import { DealCard } from "@/components/blocks/deal-card"
import { dealStageLabel } from "@/lib/deal-funnel"
import type { DealRow, DealFunnelStageOption } from "@/app/api/deals/route"
import { Column } from "./column"
import { Rail } from "./rail"
import { useBoardStore } from "./store"

type OverData = { type?: "card" | "column"; stageId?: string; dealId?: string }

// Prefer card-level droppables (precise before/after) over the column droppable
// they sit inside; fall back to the column when the pointer is over empty space.
// Only VISIBLE (mounted) cards are droppables, so this composes with the
// per-column virtualization.
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  const cardHits = pointer.filter((c) => String(c.id).startsWith("card:"))
  if (cardHits.length > 0) return cardHits
  if (pointer.length > 0) return pointer
  return rectIntersection(args)
}

export function DealsKanbanBoard({
  deals,
  stages,
  onChanged,
  boardId,
}: {
  deals: DealRow[]
  stages: DealFunnelStageOption[]
  onChanged: () => void
  boardId: string
}) {
  const { columns, collapsed, toggleCollapse, expand, setSort, move, dealById } =
    useBoardStore({ deals, stages, onChanged, boardId })

  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const activeDeal = activeId ? (dealById(activeId) ?? null) : null

  const stageLabelOf = (stageId?: string) => {
    const s = stages.find((st) => st.id === stageId)
    return s ? dealStageLabel(s.name) : null
  }

  const announcements: Announcements = {
    onDragStart({ active }) {
      const d = dealById(String(active.id))
      return d ? `Взята сделка «${d.name}».` : undefined
    },
    onDragOver({ over }) {
      const label = stageLabelOf((over?.data.current as OverData)?.stageId)
      return label ? `Над колонкой «${label}».` : undefined
    },
    onDragEnd({ active, over }) {
      const d = dealById(String(active.id))
      const label = stageLabelOf((over?.data.current as OverData)?.stageId)
      return d && label
        ? `Сделка «${d.name}» перемещена в «${label}».`
        : "Перемещение отменено."
    },
    onDragCancel() {
      return "Перемещение отменено."
    },
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const dealId = String(active.id)
    const overData = over.data.current as OverData | undefined
    const toStageId = overData?.stageId
    if (!toStageId) return

    const targetCol = columns.find((c) => c.stage.id === toStageId)
    const targetMode = targetCol?.mode ?? "manual"

    let beforeId: string | null = null
    let afterId: string | null = null

    if (overData?.type === "card" && overData.dealId) {
      if (overData.dealId === dealId) return // dropped on itself
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
    // else: dropped on a column body / collapsed rail → append (move() appends
    // when manual mode gets no neighbours).

    // Drop onto a collapsed rail auto-expands the column.
    if (collapsed[toStageId]) expand(toStageId)

    move(dealId, toStageId, beforeId, afterId, targetMode)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{ announcements }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/* Horizontal scrollbar on TOP: the double scaleY(-1) flip moves the
          scroller's scrollbar to the top edge while the inner row counter-flips
          so content reads normally. No fixed height / overflow-y → columns grow
          to fit all cards and the PAGE scrolls vertically. DnD is unaffected:
          the dragged element is the body-level DragOverlay and collision uses
          screen-space rects (the net transform on the columns is identity). */}
      <div className="overflow-x-auto" style={{ transform: "scaleY(-1)" }}>
        <div
          className="flex items-stretch gap-3 pt-1 pb-2"
          style={{ transform: "scaleY(-1)" }}
        >
          {columns.map((column) =>
            collapsed[column.stage.id] ? (
              <Rail
                key={column.stage.id}
                stage={column.stage}
                count={column.cards.length}
                onExpand={() => expand(column.stage.id)}
              />
            ) : (
              <Column
                key={column.stage.id}
                column={column}
                stages={stages}
                onChanged={onChanged}
                onCollapse={() => toggleCollapse(column.stage.id)}
                onSortChange={(mode) => setSort(column.stage.id, mode)}
              />
            ),
          )}
        </div>
      </div>

      <DragOverlay>
        {activeDeal ? (
          <div className="w-96 cursor-grabbing">
            <DealCard deal={activeDeal} stages={stages} onChanged={onChanged} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
