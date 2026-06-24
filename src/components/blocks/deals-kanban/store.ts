"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type { DealRow, DealFunnelStageOption } from "@/app/api/deals/route"
import { computePosition } from "@/lib/kanban-move"

// Per-column field sort is transient view-state — it NEVER writes to
// `deal.position`. "Вручную" renders the persisted manual order; the others
// render a sorted copy. (Spec: Value/New/Old, minus Priority/Age naming.)
export type SortMode = "manual" | "value" | "newest" | "oldest"

export const SORT_MODES: SortMode[] = ["manual", "value", "newest", "oldest"]
export const SORT_LABEL: Record<SortMode, string> = {
  manual: "Вручную",
  value: "По сумме",
  newest: "Сначала новые",
  oldest: "Сначала старые",
}

export type BoardColumn = {
  stage: DealFunnelStageOption
  mode: SortMode
  cards: DealRow[]
}

const numVal = (v: string | null): number | null => {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Manual order: keyed rows first (fractional-index ascending), unkeyed rows
// last by most-recently-updated. Stable + matches the migration backfill.
function compareManual(a: DealRow, b: DealRow): number {
  const ap = a.position
  const bp = b.position
  if (ap !== null && bp !== null) {
    if (ap < bp) return -1
    if (ap > bp) return 1
    return b.updatedAt.localeCompare(a.updatedAt)
  }
  if (ap === null && bp === null) return b.updatedAt.localeCompare(a.updatedAt)
  return ap === null ? 1 : -1
}

function sortCards(cards: DealRow[], mode: SortMode): DealRow[] {
  const copy = [...cards]
  switch (mode) {
    case "value":
      // Highest value first; rows without a value sink to the bottom.
      return copy.sort((a, b) => {
        const av = numVal(a.value)
        const bv = numVal(b.value)
        if (av === null && bv === null) return compareManual(a, b)
        if (av === null) return 1
        if (bv === null) return -1
        return bv - av
      })
    case "newest":
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    case "oldest":
      return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    case "manual":
    default:
      return copy.sort(compareManual)
  }
}

const collapseStorageKey = (boardId: string) =>
  `deals-kanban:collapsed:${boardId}`

export function useBoardStore({
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
  // Local optimistic mirror of the (already-filtered) deals. Re-synced whenever
  // the parent hands down a new array (a refetch or a filter change). A drag
  // mutates this immediately, then onChanged() refetches authoritative rows.
  const [localDeals, setLocalDeals] = useState<DealRow[]>(deals)
  useEffect(() => setLocalDeals(deals), [deals])

  const [sortByStage, setSortByStage] = useState<Record<string, SortMode>>({})
  const setSort = useCallback((stageId: string, mode: SortMode) => {
    setSortByStage((prev) => ({ ...prev, [stageId]: mode }))
  }, [])

  // Collapsed state is per-user UI state (localStorage, keyed by board). Empty
  // columns default collapsed — but only at first paint, so dragging the last
  // card out of a column doesn't yank it shut mid-session.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const initedRef = useRef(false)
  useEffect(() => {
    if (initedRef.current || stages.length === 0) return
    initedRef.current = true
    let stored: Record<string, boolean> = {}
    try {
      const raw = localStorage.getItem(collapseStorageKey(boardId))
      if (raw) stored = JSON.parse(raw)
    } catch {
      /* ignore malformed storage */
    }
    const counts = new Map<string, number>()
    for (const d of deals) {
      counts.set(d.funnelStageId, (counts.get(d.funnelStageId) ?? 0) + 1)
    }
    const init: Record<string, boolean> = {}
    for (const s of stages) {
      init[s.id] = stored[s.id] ?? (counts.get(s.id) ?? 0) === 0
    }
    setCollapsed(init)
  }, [stages, deals, boardId])

  const persistCollapsed = useCallback(
    (next: Record<string, boolean>) => {
      try {
        localStorage.setItem(collapseStorageKey(boardId), JSON.stringify(next))
      } catch {
        /* ignore quota / disabled storage */
      }
    },
    [boardId],
  )

  const toggleCollapse = useCallback(
    (stageId: string) => {
      setCollapsed((prev) => {
        const next = { ...prev, [stageId]: !prev[stageId] }
        persistCollapsed(next)
        return next
      })
    },
    [persistCollapsed],
  )

  const expand = useCallback(
    (stageId: string) => {
      setCollapsed((prev) => {
        if (prev[stageId] === false) return prev
        const next = { ...prev, [stageId]: false }
        persistCollapsed(next)
        return next
      })
    },
    [persistCollapsed],
  )

  const collapseStage = useCallback(
    (stageId: string) => {
      setCollapsed((prev) => {
        if (prev[stageId]) return prev
        const next = { ...prev, [stageId]: true }
        persistCollapsed(next)
        return next
      })
    },
    [persistCollapsed],
  )

  const columns: BoardColumn[] = useMemo(() => {
    const byStage = new Map<string, DealRow[]>()
    for (const s of stages) byStage.set(s.id, [])
    for (const d of localDeals) {
      byStage.get(d.funnelStageId)?.push(d)
    }
    return stages.map((stage) => {
      const mode = sortByStage[stage.id] ?? "manual"
      return { stage, mode, cards: sortCards(byStage.get(stage.id) ?? [], mode) }
    })
  }, [stages, localDeals, sortByStage])

  const dealById = useCallback(
    (id: string) => localDeals.find((d) => d.id === id),
    [localDeals],
  )

  // Persisted move: change a deal's column (funnel stage) and/or manual slot.
  // `beforeId`/`afterId` are the display neighbours at the drop point (already
  // excluding the dragged card). For a FIELD-SORTED target column we ignore
  // them and append in manual order — the card lands in its sorted slot on
  // re-render while manual order stays meaningful underneath.
  const move = useCallback(
    async (
      dealId: string,
      toStageId: string,
      beforeId: string | null,
      afterId: string | null,
      targetMode: SortMode,
    ) => {
      const moving = localDeals.find((d) => d.id === dealId)
      if (!moving) return
      const targetStage = stages.find((s) => s.id === toStageId)
      if (!targetStage) return

      const colCards = localDeals
        .filter((d) => d.funnelStageId === toStageId && d.id !== dealId)
        .sort(compareManual)

      let beforeKey: string | null = null
      let afterKey: string | null = null
      if (targetMode === "manual" && (beforeId || afterId)) {
        beforeKey = beforeId ? (dealById(beforeId)?.position ?? null) : null
        afterKey = afterId ? (dealById(afterId)?.position ?? null) : null
      } else {
        // Append after the last keyed card in manual order.
        beforeKey =
          [...colCards].reverse().find((c) => c.position !== null)?.position ??
          null
        afterKey = null
      }

      // No-op guard: same column, same neighbours → nothing to persist.
      const before = beforeId ? dealById(beforeId) : null
      if (
        moving.funnelStageId === toStageId &&
        targetMode === "manual" &&
        ((before && before.position === moving.position) ||
          (beforeKey === null &&
            afterKey === null &&
            colCards.length === 0))
      ) {
        return
      }

      let newPos: string
      try {
        newPos = computePosition(beforeKey, afterKey)
      } catch {
        // Neighbour keys weren't strictly ordered (e.g. unkeyed rows) — append.
        const lastKeyed =
          [...colCards].reverse().find((c) => c.position !== null)?.position ??
          null
        newPos = computePosition(lastKeyed, null)
      }

      // Auto-collapse the SOURCE column when this move empties it (drag the
      // last card out → it folds to a rail). Applied optimistically and
      // reverted if the persist fails, so the board reacts instantly.
      const fromStageId = moving.funnelStageId
      const sourceWillEmpty =
        fromStageId !== toStageId &&
        !localDeals.some(
          (d) => d.id !== dealId && d.funnelStageId === fromStageId,
        )

      const snapshot = localDeals
      setLocalDeals((prev) =>
        prev.map((d) =>
          d.id === dealId
            ? {
                ...d,
                funnelStageId: toStageId,
                funnelStageName: targetStage.name,
                funnelStageProbability: targetStage.closureProbability,
                position: newPos,
              }
            : d,
        ),
      )
      if (sourceWillEmpty) collapseStage(fromStageId)

      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: dealId,
            moveOnly: true,
            funnelStageId: toStageId,
            position: newPos,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || "Не удалось переместить сделку")
        }
        onChanged()
      } catch (err) {
        setLocalDeals(snapshot)
        if (sourceWillEmpty) expand(fromStageId) // undo the optimistic collapse
        toast.error(
          err instanceof Error ? err.message : "Не удалось переместить сделку",
        )
      }
    },
    [localDeals, stages, dealById, onChanged, collapseStage, expand],
  )

  return {
    columns,
    collapsed,
    toggleCollapse,
    expand,
    setSort,
    move,
    dealById,
  }
}
