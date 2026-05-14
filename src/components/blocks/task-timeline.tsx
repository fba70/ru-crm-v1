"use client"

import { useMemo, useState } from "react"
import { addDays, differenceInCalendarDays, format, startOfDay } from "date-fns"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import type { TaskRow } from "@/app/api/tasks/route"
import TaskEditDialog from "@/components/forms/form-task-edit"

// Color rules — applied per-row, replace the old priority-based palette.
//   • Done → green, regardless of due date. A completed-but-late task
//     shouldn't scream red; completion overrides date alarming.
//   • Today is at or past the due date → red.
//   • Due within 3 days (exclusive of today) → yellow.
//   • Otherwise → light blue.
function colorForTask(task: TaskRow, today: Date): string {
  if (task.status === "done") {
    return "bg-emerald-500/60 hover:bg-emerald-500/80 border-emerald-700/60"
  }
  const due = startOfDay(new Date(task.dueDate))
  const days = differenceInCalendarDays(due, today)
  if (days <= 0) return "bg-red-500/60 hover:bg-red-500/80 border-red-700/60"
  if (days <= 3)
    return "bg-amber-500/60 hover:bg-amber-500/80 border-amber-700/60"
  return "bg-sky-400/60 hover:bg-sky-400/80 border-sky-600/60"
}

const SIDEBAR_REM = 12
const ROW_HEIGHT = 40
const HEADER_HEIGHT = 36
const MAX_VISIBLE_ROWS = 12

// Closed tasks live in the kanban only (per product call). Render order
// here also drives top-to-bottom group order in the timeline.
const TIMELINE_STATUSES = ["todo", "in_progress", "done"] as const
type TimelineStatus = (typeof TIMELINE_STATUSES)[number]

const STATUS_LABELS: Record<TimelineStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
}

type Tick = { date: Date; offsetDays: number }

function pickStep(days: number): { stepDays: number; fmt: string } {
  if (days <= 14) return { stepDays: 1, fmt: "MMM d" }
  if (days <= 60)
    return { stepDays: Math.max(1, Math.ceil(days / 8)), fmt: "MMM d" }
  if (days <= 365)
    return { stepDays: Math.max(1, Math.ceil(days / 10)), fmt: "MMM d" }
  return { stepDays: Math.max(1, Math.ceil(days / 10)), fmt: "MMM yyyy" }
}

function toInputDate(d: Date): string {
  return format(d, "yyyy-MM-dd")
}

// Local-midnight interpretation: timeline windows are user-facing, not
// server timestamps, so the user's local TZ is what reads naturally.
// Returns null on partial / invalid input so the grid stays stable
// while the user is mid-edit instead of collapsing to NaN days.
function fromInputDate(s: string): Date | null {
  if (!s) return null
  const d = new Date(`${s}T00:00:00`)
  if (isNaN(d.getTime())) return null
  return startOfDay(d)
}

export function TaskTimeline({
  tasks,
  onChanged,
}: {
  tasks: TaskRow[]
  onChanged: () => void
}) {
  const today = useMemo(() => startOfDay(new Date()), [])
  const defaultFrom = useMemo(() => addDays(today, -7), [today])
  const defaultTo = useMemo(() => addDays(today, 7), [today])

  const [fromStr, setFromStr] = useState<string>(() => toInputDate(defaultFrom))
  const [toStr, setToStr] = useState<string>(() => toInputDate(defaultTo))
  const [excludeDone, setExcludeDone] = useState(false)

  const fromDate = fromInputDate(fromStr) ?? defaultFrom
  const toDateRaw = fromInputDate(toStr) ?? defaultTo
  // Guard against from > to (mid-edit): clamp so the grid never has
  // negative days.
  const minDate = fromDate
  const maxDate = toDateRaw >= fromDate ? toDateRaw : fromDate
  const totalDays = Math.max(1, differenceInCalendarDays(maxDate, minDate) + 1)

  const { stepDays, fmt } = pickStep(totalDays)
  const ticks: Tick[] = []
  for (let i = 0; i <= totalDays - 1; i += stepDays) {
    ticks.push({ date: addDays(minDate, i), offsetDays: i })
  }
  if (ticks[ticks.length - 1]?.offsetDays !== totalDays) {
    ticks.push({ date: maxDate, offsetDays: totalDays })
  }

  const todayOffset = differenceInCalendarDays(today, minDate)
  const todayInRange = todayOffset >= 0 && todayOffset <= totalDays

  // Filter: closed is always hidden (kanban-only); done is hidden when
  // the user opts in. Page-level filters (assignee/client/etc.) have
  // already been applied to `tasks` by the caller.
  const visible = useMemo(
    () =>
      tasks.filter((t) => {
        if (t.status === "closed") return false
        if (excludeDone && t.status === "done") return false
        return true
      }),
    [tasks, excludeDone],
  )

  const grouped = useMemo(() => {
    const map: Record<TimelineStatus, TaskRow[]> = {
      todo: [],
      in_progress: [],
      done: [],
    }
    for (const t of visible) {
      // Closed already filtered above; this narrow keeps TS happy.
      if (t.status !== "closed") map[t.status].push(t)
    }
    return map
  }, [visible])

  // Skip groups with zero tasks so the timeline doesn't render empty
  // headers.
  const visibleGroups = TIMELINE_STATUSES.filter((s) => grouped[s].length > 0)

  const totalRows =
    visibleGroups.length +
    visibleGroups.reduce((acc, s) => acc + grouped[s].length, 0)
  const needsVerticalScroll = totalRows > MAX_VISIBLE_ROWS
  const scrollMaxHeight = needsVerticalScroll
    ? HEADER_HEIGHT + MAX_VISIBLE_ROWS * ROW_HEIGHT + 1
    : undefined

  const todayLeft = `calc(${SIDEBAR_REM}rem + (100% - ${SIDEBAR_REM}rem) * ${todayOffset / totalDays})`

  function resetWindow() {
    setFromStr(toInputDate(defaultFrom))
    setToStr(toInputDate(defaultTo))
  }

  return (
    <div className="space-y-3">
      {/* Filter row — timeline-local. Page-level filters still feed
          the parent `tasks` prop. */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">
            From
          </Label>
          <Input
            type="date"
            value={fromStr}
            onChange={(e) => setFromStr(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">To</Label>
          <Input
            type="date"
            value={toStr}
            onChange={(e) => setToStr(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={resetWindow}
        >
          Reset to ±1 week
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          <Checkbox
            id="timeline-exclude-done"
            checked={excludeDone}
            onCheckedChange={(v) => setExcludeDone(v === true)}
          />
          <Label
            htmlFor="timeline-exclude-done"
            className="text-xs text-muted-foreground cursor-pointer"
          >
            Exclude done tasks
          </Label>
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground border rounded-md">
          No tasks to display in the timeline.
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <div
            className={`relative overflow-x-hidden ${needsVerticalScroll ? "overflow-y-auto" : "overflow-y-hidden"}`}
            style={scrollMaxHeight ? { maxHeight: scrollMaxHeight } : undefined}
          >
            {/* Sticky header */}
            <div className="sticky top-0 z-20 flex bg-muted/60 backdrop-blur border-b">
              <div
                className="shrink-0 px-3 py-2 text-sm font-medium border-r"
                style={{ width: `${SIDEBAR_REM}rem` }}
              >
                Task
              </div>
              <div
                className="relative flex-1"
                style={{ height: HEADER_HEIGHT }}
              >
                {todayInRange && (
                  <div
                    className="absolute top-0.5 -translate-x-1/2 rounded-sm bg-red-500 text-white text-[10px] px-1 leading-4 z-10 pointer-events-none"
                    style={{
                      left: `${(todayOffset / totalDays) * 100}%`,
                    }}
                  >
                    today
                  </div>
                )}
                {ticks.map((t, i) => {
                  const leftPct = (t.offsetDays / totalDays) * 100
                  const isLast = i === ticks.length - 1
                  return (
                    <div
                      key={i}
                      className="absolute bottom-1 flex items-end text-xs text-muted-foreground"
                      style={{
                        left: `${leftPct}%`,
                        transform: isLast ? "translateX(-100%)" : undefined,
                      }}
                    >
                      <span className="px-1 whitespace-nowrap">
                        {format(t.date, fmt)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Body — grid lines + today line + group sections */}
            <div className="relative">
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{ left: `${SIDEBAR_REM}rem`, right: 0 }}
              >
                {ticks.map((t, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-dashed border-muted-foreground/15"
                    style={{
                      left: `${(t.offsetDays / totalDays) * 100}%`,
                    }}
                  />
                ))}
              </div>

              {todayInRange && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500/70 pointer-events-none z-10"
                  style={{ left: todayLeft }}
                />
              )}

              {visibleGroups.map((status) => (
                <div key={status}>
                  <div
                    className="flex border-b bg-muted/40"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 w-full">
                      <span>{STATUS_LABELS[status]}</span>
                      <span className="text-muted-foreground/70 normal-case font-normal">
                        ({grouped[status].length})
                      </span>
                    </div>
                  </div>

                  {grouped[status].map((task) => {
                    const start = startOfDay(new Date(task.createdAt))
                    const end = startOfDay(new Date(task.dueDate))
                    // Bar visibility: only render when [start, end]
                    // intersects [minDate, maxDate]; otherwise the row
                    // shows but the timeline column is empty.
                    const intersects = start <= maxDate && end >= minDate
                    const startOffset = Math.max(
                      0,
                      differenceInCalendarDays(start, minDate),
                    )
                    const endOffsetExclusive = Math.min(
                      totalDays,
                      differenceInCalendarDays(end, minDate) + 1,
                    )
                    const durationDays = Math.max(
                      1,
                      endOffsetExclusive - startOffset,
                    )
                    const leftPct = (startOffset / totalDays) * 100
                    const widthPct = (durationDays / totalDays) * 100
                    const barClass = colorForTask(task, today)
                    return (
                      <div
                        key={task.id}
                        className="flex border-b last:border-b-0 hover:bg-muted/30"
                        style={{ height: ROW_HEIGHT }}
                      >
                        <div
                          className="shrink-0 px-3 py-2 text-sm truncate border-r flex items-center"
                          style={{ width: `${SIDEBAR_REM}rem` }}
                          title={task.name}
                        >
                          {task.name}
                        </div>
                        <div className="relative flex-1">
                          {intersects && (
                            <TaskEditDialog
                              mode="edit"
                              task={task}
                              onSuccess={onChanged}
                              trigger={
                                <button
                                  type="button"
                                  className={`absolute top-1.5 bottom-1.5 rounded-md border text-[11px] font-medium text-white/95 truncate px-2 flex items-center cursor-pointer transition-colors shadow-sm ${barClass}`}
                                  style={{
                                    left: `${leftPct}%`,
                                    width: `${widthPct}%`,
                                    minWidth: 4,
                                  }}
                                  title={`${task.name} · ${format(start, "MMM d")} → ${format(end, "MMM d, yyyy")}`}
                                >
                                  <span className="truncate">{task.name}</span>
                                </button>
                              }
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/30 border-t">
            <span>
              {format(minDate, "MMM d, yyyy")} —{" "}
              {format(maxDate, "MMM d, yyyy")}
            </span>
            <span>
              {visible.length} task{visible.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
