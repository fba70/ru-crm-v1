"use client"

// Хук доски сделок: параллельно тянет весь «интел» борда (предложения агента,
// ленту решений, интел по сделкам + коммитменты стадий, ближайший шаг по задачам)
// и отдаёт refetch. Все ответы деградируют мягко — при ошибке фетча сохраняем
// предыдущие данные и никогда не бросаем.
//
// ВАЖНО: типы контракта импортируются как type-only — модуль deals-mock серверный
// и не должен попадать в клиентский бандл.

import { useCallback, useEffect, useRef, useState } from "react"

import type {
  DealProposal,
  FeedEvent,
  DealIntel,
  StageCommitments,
} from "@/server/deals-mock"
import type { TaskRow } from "@/app/api/tasks/route"

export type NextStep = { name: string; dueDate: string }

export type BoardIntelData = {
  proposals: DealProposal[]
  feed: FeedEvent[]
  intel: Record<string, DealIntel>
  commitments: StageCommitments
  nextStepByDeal: Record<string, NextStep | null>
  // Сколько переводов агент авто-применил в ЭТОМ фетче (/api/deals/proposals
  // применяет предложения на лету). > 0 → доска должна подтянуть свежие
  // стадии (router.refresh в deals-board); повторный фетч вернёт 0 — цикла нет.
  appliedMoves: number
}

// Стабильная по ссылке заглушка данных — безопасна для первого рендера.
const EMPTY: BoardIntelData = {
  proposals: [],
  feed: [],
  intel: {},
  commitments: {},
  nextStepByDeal: {},
  appliedMoves: 0,
}

export function useBoardIntel(): {
  data: BoardIntelData
  loading: boolean
  refetch: () => void
} {
  const [data, setData] = useState<BoardIntelData>(EMPTY)
  const [loading, setLoading] = useState(true)
  // Guard от гонки: у каждого вызова load() свой номер; применяем результат
  // только если это последний запрос — поздний ответ не затирает свежий.
  const latestRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++latestRef.current
    setLoading(true)
    try {
      const [proposalsRes, feedRes, intelRes, tasksRes] = await Promise.all([
        fetch("/api/deals/proposals"),
        fetch("/api/deals/feed"),
        fetch("/api/deals/intel"),
        fetch("/api/tasks"),
      ])
      if (
        !proposalsRes.ok ||
        !feedRes.ok ||
        !intelRes.ok ||
        !tasksRes.ok
      ) {
        throw new Error("Не удалось загрузить данные доски")
      }

      const [proposalsJson, feedJson, intelJson, tasksJson] =
        await Promise.all([
          proposalsRes.json() as Promise<{
            proposals?: DealProposal[]
            applied?: number
          }>,
          feedRes.json() as Promise<{ events?: FeedEvent[] }>,
          intelRes.json() as Promise<{
            intel?: Record<string, DealIntel>
            commitments?: StageCommitments
          }>,
          tasksRes.json() as Promise<{ tasks?: TaskRow[] }>,
        ])

      // Ближайший шаг по сделке: самая ранняя по dueDate открытая задача.
      const nextStepByDeal: Record<string, NextStep | null> = {}
      for (const t of tasksJson.tasks ?? []) {
        if (!t.dealId) continue
        if (t.status === "done" || t.status === "closed") continue
        const existing = nextStepByDeal[t.dealId]
        if (!existing || t.dueDate.localeCompare(existing.dueDate) < 0) {
          nextStepByDeal[t.dealId] = { name: t.name, dueDate: t.dueDate }
        }
      }

      // Устаревший ответ (пока летел, стартовал новый load) — не применяем.
      if (latestRef.current !== seq) return

      setData({
        proposals: proposalsJson.proposals ?? [],
        feed: feedJson.events ?? [],
        intel: intelJson.intel ?? {},
        commitments: intelJson.commitments ?? {},
        nextStepByDeal,
        appliedMoves: proposalsJson.applied ?? 0,
      })
    } catch {
      // Мягкая деградация: сохраняем предыдущие данные, ничего не бросаем.
    } finally {
      // loading гасит только последний запрос (более новый сам собой управит).
      if (latestRef.current === seq) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, refetch: load }
}
