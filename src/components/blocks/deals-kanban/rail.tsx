"use client"

import { useDroppable } from "@dnd-kit/core"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { dealStageLabel } from "@/lib/deal-funnel"
import { STAGE_COLOR, STAGE_DEFAULT } from "@/lib/deal-board"
import type { DealFunnelStageOption } from "@/app/api/deals/route"

// Collapsed column: a narrow vertical rail. Still a valid drop target — a card
// dropped here appends to the stage and the board auto-expands it (handled in
// board.tsx onDragEnd). Окрашена в цвет заголовочной карточки стадии; показывает
// count + сумму. Разворот — по кнопке-шеврону (реагирует на ховер).
export function Rail({
  stage,
  count,
  amount,
  onExpand,
}: {
  stage: DealFunnelStageOption
  count: number
  // Агрегированная сумма по колонке (aggregateByCurrency) — как в шапке колонки.
  amount: string
  onExpand: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${stage.id}`,
    data: { type: "column" as const, stageId: stage.id },
  })
  const colorClass = STAGE_COLOR[stage.name] ?? STAGE_DEFAULT

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full w-13 flex-shrink-0 flex-col items-center gap-2 rounded-lg border py-2 transition-colors ${colorClass} ${
        isOver ? "outline outline-2 outline-dashed outline-primary" : ""
      }`}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onExpand}
        aria-label={`Развернуть «${dealStageLabel(stage.name)}»`}
        className="h-6 w-6 shrink-0 cursor-pointer hover:bg-black/10 dark:hover:bg-white/15"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {/* Всё прижато к верху, текст читается сверху вниз: без flex-1 и без
          rotate(180deg) — они растягивали название на всю высоту и
          «начинали» его от нижнего края. */}
      {/* text-foreground явно: пилюля сама тёмная/светлая от --background,
          а унаследованный цвет стадии (например ink на «Переговорах» в
          тёмной теме) на ней не читается. */}
      <span className="rounded-full bg-background/60 px-1.5 text-xs font-medium tabular-nums text-foreground">
        {count}
      </span>
      <span
        className="mt-0.5 text-sm font-medium"
        style={{ writingMode: "vertical-rl" }}
      >
        {dealStageLabel(stage.name)}
      </span>
      {amount && (
        <span
          className="text-[11px] opacity-80 tabular-nums"
          style={{ writingMode: "vertical-rl" }}
        >
          {amount}
        </span>
      )}
    </div>
  )
}
