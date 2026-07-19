"use client"

import { useEffect, useState, useTransition } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Pencil, Sparkles } from "lucide-react"
import { toast } from "sonner"
import type { DealRow, DealFunnelStageOption } from "@/app/api/deals/route"
import type { TaskRow } from "@/app/api/tasks/route"
import { dealStageLabel } from "@/lib/deal-funnel"
import { STAGE_COLOR, STAGE_DEFAULT, formatAmount } from "@/lib/deal-board"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { DealContactsRoles } from "@/components/blocks/deal-contacts-roles"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function DealDetailDrawer({
  deal,
  stages,
  open,
  onOpenChange,
  onChanged,
}: {
  deal: DealRow | null
  stages: DealFunnelStageOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  // Стадию берём прямо из deal.funnelStageId — после перевода onChanged →
  // router.refresh обновляет проп (deal выводится из живого списка на доске).
  // Задачи храним вместе с их dealId, чтобы при переключении сделки сразу
  // показывать пустоту, а не задачи прошлой сделки (без синхронного setState).
  const [taskData, setTaskData] = useState<{
    dealId: string
    items: TaskRow[]
  } | null>(null)
  const [isPending, startTransition] = useTransition()

  const dealId = deal?.id
  useEffect(() => {
    if (!open || !dealId) return
    let cancelled = false
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data: { tasks?: TaskRow[] }) => {
        if (cancelled) return
        const items = (data.tasks ?? [])
          .filter((t) => t.dealId === dealId)
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        setTaskData({ dealId, items })
      })
      .catch(() => {
        if (!cancelled) setTaskData({ dealId, items: [] })
      })
    return () => {
      cancelled = true
    }
  }, [open, dealId])

  if (!deal) return null

  const isActive = deal.status === "active"
  const company = deal.clientName ?? deal.name
  const product = deal.clientName ? deal.name : null
  const amount = formatAmount(deal.value, deal.currency)
  const tasks = taskData && taskData.dealId === deal.id ? taskData.items : []
  const currentStage = stages.find((s) => s.id === deal.funnelStageId)
  const stageClass = currentStage
    ? (STAGE_COLOR[currentStage.name] ?? STAGE_DEFAULT)
    : STAGE_DEFAULT

  function handleStageChange(nextStageId: string) {
    if (!deal || nextStageId === deal.funnelStageId) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: deal.id,
            move: true,
            funnelStageId: nextStageId,
            note: "",
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось перевести сделку")
          return
        }
        const name = stages.find((s) => s.id === nextStageId)?.name
        toast.success(`Переведено: ${name ? dealStageLabel(name) : "этап"}`)
        onChanged()
      } catch {
        toast.error("Не удалось перевести сделку")
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
        <SheetHeader className="p-4 pb-3 border-b">
          {/* pr-8 — чтобы кнопка «Редактировать» не залезала под крестик закрытия */}
          <div className="flex items-start justify-between gap-2 pr-8">
            <div className="min-w-0">
              <SheetTitle className="truncate">{company}</SheetTitle>
              {product && (
                <div className="text-sm text-muted-foreground truncate">
                  {product}
                </div>
              )}
            </div>
            <DealEditDialog
              mode="edit"
              deal={deal}
              onSuccess={onChanged}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Редактировать
                </Button>
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="secondary" className={stageClass}>
              {currentStage ? dealStageLabel(currentStage.name) : "—"}
            </Badge>
            {amount && <span className="text-sm font-semibold">{amount}</span>}
            {deal.userName && (
              <span className="text-sm text-muted-foreground">
                · {deal.userName}
              </span>
            )}
            {deal.status === "cancelled" && (
              <Badge
                variant="secondary"
                className="bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"
              >
                Отменена
              </Badge>
            )}
            {deal.status === "deleted" && (
              <Badge
                variant="secondary"
                className="bg-red-500/15 text-red-600 dark:text-red-300"
              >
                Удалена
              </Badge>
            )}
          </div>

          <div className="pt-1">
            <Select
              value={deal.funnelStageId}
              onValueChange={handleStageChange}
              disabled={isPending || !isActive}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Перевести по воронке" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {dealStageLabel(s.name)} (
                    {Math.round(s.closureProbability * 100)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SheetHeader>

        {/* Происхождение сделки (reasoning/changes) — подробно, только здесь;
            на карточках доски больше не показывается. */}
        {(deal.reasoning || deal.changes) && (
          <div className="mx-4 mt-3 rounded-lg border bg-violet-500/5 p-3 text-sm space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
              <Sparkles className="h-3.5 w-3.5" />
              Происхождение
            </div>
            {deal.changes && (
              <div>
                <div className="text-xs text-muted-foreground">Изменение</div>
                <div className="whitespace-pre-wrap">{deal.changes}</div>
              </div>
            )}
            {deal.reasoning && (
              <div>
                <div className="text-xs text-muted-foreground">Обоснование</div>
                <div className="whitespace-pre-wrap">{deal.reasoning}</div>
              </div>
            )}
          </div>
        )}

        <Tabs defaultValue="tasks" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-4 mt-3 w-fit">
            <TabsTrigger value="tasks">
              Задачи
              {tasks.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({tasks.length})
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="chronology">Хронология</TabsTrigger>
            <TabsTrigger value="contacts">Контакты</TabsTrigger>
          </TabsList>

          <TabsContent
            value="chronology"
            className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 text-sm"
          >
            {(() => {
              const events: { date: string; text: string; meta?: string }[] = []
              if (deal.changes) {
                events.push({
                  date: deal.updatedAt,
                  text: deal.changes,
                  meta: "изменение",
                })
              }
              for (const t of tasks) {
                events.push({
                  date: t.dueDate,
                  text: t.name,
                  meta: `задача · ${t.status}`,
                })
              }
              events.push({ date: deal.createdAt, text: "Сделка создана" })
              events.sort((a, b) => b.date.localeCompare(a.date))
              return events.length === 0 ? (
                <div className="text-muted-foreground">
                  Пока нет событий по сделке.
                </div>
              ) : (
                events.map((e, i) => (
                  <div key={i} className="border-l-2 pl-3 pb-1">
                    <div className="text-xs text-muted-foreground">
                      {formatDate(e.date)}
                      {e.meta ? ` · ${e.meta}` : ""}
                    </div>
                    <div className="whitespace-pre-wrap">{e.text}</div>
                  </div>
                ))
              )
            })()}
          </TabsContent>

          <TabsContent
            value="contacts"
            className="flex-1 min-h-0 overflow-y-auto p-4 text-sm"
          >
            <DealContactsRoles dealId={deal.id} clientId={deal.clientId} />
          </TabsContent>

          <TabsContent
            value="tasks"
            className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 text-sm"
          >
            {tasks.length === 0 ? (
              <div className="text-muted-foreground">Нет задач по сделке.</div>
            ) : (
              tasks.map((t, i) => (
                <div
                  key={t.id}
                  className="rounded-md border p-2.5 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium leading-snug">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(t.dueDate)}
                      {i === 0 && (
                        <span className="ml-1.5 text-foreground">
                          · ближайший
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {t.status}
                  </Badge>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
