"use client"

import { useDroppable } from "@dnd-kit/core"
import {
  ArrowDownUp,
  ChevronRight,
  PanelLeftClose,
  Trash2,
  Trophy,
} from "lucide-react"
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
import {
  aggregateByCurrency,
  aggregateByCurrencyCompact,
  dealAmount,
} from "@/lib/deal-board"
import type { DealRow } from "@/app/api/deals/route"
import type { DealIntel } from "@/server/deals-mock"
import type { DealTaskInfo } from "@/hooks/use-board-intel"
import { DealKanbanCard } from "@/components/blocks/deal-kanban-card"
import {
  TERMINAL_SORT_LABEL,
  TERMINAL_SORT_MODES,
  type TerminalSortMode,
} from "./store"

// Sentinel-«стадия» droppable-зоны финальной колонки. В воронке два терминальных
// этапа (Closed/Rejected), а колонка одна: дроп в неё → диалог исхода в board.tsx
// решает, какой именно этап назначить. Карточки-цели внутри несут РЕАЛЬНЫЙ id
// своей стадии, поэтому board трактует и sentinel, и терминальные id одинаково.
export const FINAL_DROP_ID = "__final__"

// «Драгоценный» тон заголовка финальной колонки (как STAGE_COLOR у обычных
// стадий) — глубокий сапфир. Колонка объединяет выигранные/проигранные, поэтому
// сам заголовок нейтрально-премиальный и не конкурирует с зелёным/графитом
// карточек. Текст/иконки — белые (светлые) на этом фоне.
const DIAMOND_HEADER = "bg-[#294A6B] text-white"

const entriesOf = (deals: DealRow[]) =>
  deals.map((d) => ({ amount: dealAmount(d.value), currency: d.currency }))

// Финальная колонка «Закрытие» — теперь полноценная колонка (как остальные): drop-
// цель для закрытия сделок, статистика Выиграно/Проиграно в заголовке, карточки
// в теле, свой набор сортировок. `cards` — уже отсортированные карточки исходов
// (активные Closed + активные Rejected); `wonDeals`/`lostDeals` — множества для
// статистики (в «проиграно» также входят отменённые — только как число).
export function TerminalColumn({
  cards,
  wonDeals,
  lostDeals,
  mode,
  onSortChange,
  collapsed,
  onCollapse,
  onExpand,
  intelById,
  tasksByDeal,
  intelLoaded,
  onChanged,
  onOpen,
}: {
  cards: DealRow[]
  wonDeals: DealRow[]
  lostDeals: DealRow[]
  mode: TerminalSortMode
  onSortChange: (mode: TerminalSortMode) => void
  collapsed: boolean
  onCollapse: () => void
  onExpand: () => void
  intelById: Record<string, DealIntel>
  tasksByDeal: Record<string, DealTaskInfo[]>
  intelLoaded: boolean
  onChanged: () => void
  onOpen: (deal: DealRow) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${FINAL_DROP_ID}`,
    data: { type: "column" as const, stageId: FINAL_DROP_ID },
  })

  // Свёрнутое состояние — узкий рельс (как у обычных колонок). Тот же droppable,
  // поэтому дроп на рельс тоже открывает диалог исхода (board разворачивает её).
  // Показываем ОБА исхода: зелёная пилюля-счётчик + сумма (Выиграно) и графитовая
  // (Проиграно) — иначе одна общая сумма в свёрнутом виде непонятна.
  if (collapsed) {
    const wonSum = aggregateByCurrencyCompact(entriesOf(wonDeals))
    const lostSum = aggregateByCurrencyCompact(entriesOf(lostDeals))
    return (
      <div
        ref={setNodeRef}
        className={`flex h-full w-13 flex-shrink-0 flex-col items-center gap-3 rounded-lg border py-2 transition-colors ${DIAMOND_HEADER} ${
          isOver ? "outline outline-2 outline-dashed outline-primary" : ""
        }`}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onExpand}
          aria-label="Развернуть «Закрытие»"
          className="h-6 w-6 shrink-0 cursor-pointer hover:bg-black/10 dark:hover:bg-white/15"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {/* Всё читается СНИЗУ ВВЕРХ (sideways-lr). Порядок сверху вниз обратный
            порядку чтения: проигранные, выигранные, и в самом НИЗУ — заголовок
            «Закрытие» (он читается первым). В каждом исходе цифры сверху, а
            иконка снизу — при чтении снизу вверх иконка идёт ПЕРВОЙ, потом цифры.
            Иконки повёрнуты на 90° (лежат вдоль текста). */}
        <div className="flex flex-col items-center gap-1">
          <span
            className="text-[11px] font-medium tabular-nums text-white/90"
            style={{ writingMode: "sideways-lr" }}
          >
            {lostDeals.length} · {lostSum}
          </span>
          <Trash2 className="h-3.5 w-3.5 -rotate-90 text-white/80" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <span
            className="text-[11px] font-medium tabular-nums text-white/90"
            style={{ writingMode: "sideways-lr" }}
          >
            {wonDeals.length} · {wonSum}
          </span>
          <Trophy className="h-3.5 w-3.5 -rotate-90 text-white/80" />
        </div>
        <span
          className="text-sm font-medium"
          style={{ writingMode: "sideways-lr" }}
        >
          Закрытие
        </span>
      </div>
    )
  }

  return (
    <div className="min-w-44 flex-1 min-h-0 flex flex-col gap-2">
      <div className={`shrink-0 rounded-lg border p-2.5 ${DIAMOND_HEADER}`}>
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            {/* Заголовок как у обычных колонок: название + процент закрытия.
                «Закрытие» = терминальный (закрытый) этап → 100%. */}
            <div className="flex items-baseline gap-2 text-sm font-medium">
              <span className="truncate">Закрытие</span>
              <span className="text-xs opacity-70 shrink-0">100%</span>
            </div>
            {/* Подзаголовок в ОДНУ строку (тот же размер/шрифт, что строка
                статистики у обычных колонок): флажок = выиграно, корзина =
                проиграно. Точные суммы — в тултипе. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="mt-0.5 flex items-center gap-2 truncate text-xs text-white/80 cursor-default">
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Trophy className="h-3 w-3 shrink-0" />
                    {wonDeals.length} ·{" "}
                    {aggregateByCurrencyCompact(entriesOf(wonDeals))}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Trash2 className="h-3 w-3 shrink-0" />
                    {lostDeals.length} ·{" "}
                    {aggregateByCurrencyCompact(entriesOf(lostDeals))}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="space-y-0.5">
                <div>Выиграно: {aggregateByCurrency(entriesOf(wonDeals))}</div>
                <div>Проиграно: {aggregateByCurrency(entriesOf(lostDeals))}</div>
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
                <TooltipContent>
                  Сортировка: {TERMINAL_SORT_LABEL[mode]}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Сортировка</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={mode}
                  onValueChange={(v) => onSortChange(v as TerminalSortMode)}
                >
                  {TERMINAL_SORT_MODES.map((m) => (
                    <DropdownMenuRadioItem key={m} value={m}>
                      {TERMINAL_SORT_LABEL[m]}
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
                  aria-label="Свернуть «Закрытие»"
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
        {cards.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            Перетащите сюда сделку, чтобы закрыть её как выигранную или
            проигранную.
          </div>
        ) : (
          cards.map((d) => (
            <DealKanbanCard
              key={d.id}
              deal={d}
              onChanged={onChanged}
              onOpen={onOpen}
              tasks={tasksByDeal[d.id] ?? []}
              intel={intelById[d.id]}
              intelLoaded={intelLoaded}
            />
          ))
        )}
      </div>
    </div>
  )
}
