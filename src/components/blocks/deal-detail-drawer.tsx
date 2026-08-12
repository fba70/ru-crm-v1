"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Pencil,
  Sparkles,
  Send,
  Mail,
  Phone,
  Plus,
  ChevronDown,
  Link2,
  AlertTriangle,
} from "lucide-react"
import type { TaskStatus } from "@/db/schema"
import { mockAtRisk, mockRiskReason } from "@/lib/deal-mocks"
import { toast } from "sonner"
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  TASK_TYPE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_BADGE,
} from "@/lib/task-labels"
import TaskEditDialog from "@/components/forms/form-task-edit"
import type { DealRow, DealFunnelStageOption } from "@/app/api/deals/route"
import type { TaskRow } from "@/app/api/tasks/route"
import { dealStageLabel } from "@/lib/deal-funnel"
import { formatAmount } from "@/lib/deal-board"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { DealContactsRoles } from "@/components/blocks/deal-contacts-roles"

// МОК происхождения сделки (UX №14): из какого канала заведена. Реальный
// источник должен приходить с бэка (source_item сделки). Детерминированно
// по id, чтобы не мигало между рендерами.
// TODO(backend): брать канал из первичного source_item сделки.
function dealOriginMock(id: string): { label: string; Icon: typeof Send } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const variants = [
    { label: "из письма", Icon: Mail },
    { label: "из Telegram", Icon: Send },
    { label: "из звонка", Icon: Phone },
  ] as const
  return variants[h % variants.length]
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

// Одно мета-поле задачи в сетке подробностей: лейбл сверху, значение снизу.
// Пустое значение не рендерится (не оставляет дыр в сетке).
function TaskMeta({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="truncate text-foreground">{value}</div>
    </div>
  )
}

export function DealDetailDrawer({
  deal,
  stages,
  currentUserId,
  open,
  onOpenChange,
  onChanged,
}: {
  deal: DealRow | null
  stages: DealFunnelStageOption[]
  // Для прав смены статуса задачи (инициатор/исполнитель).
  currentUserId: string
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
  // Диалог «Связать с задачей»: задачи клиента без привязки к этой сделке.
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkCandidates, setLinkCandidates] = useState<TaskRow[]>([])

  const dealId = deal?.id
  // Загрузка задач сделки, вынесена для повторного вызова после создания
  // задачи прямо из drawer (кнопка «Новая задача» во вкладке Задачи).
  const reloadTasks = useCallback((id: string) => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data: { tasks?: TaskRow[] }) => {
        const items = (data.tasks ?? [])
          .filter((t) => t.dealId === id)
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        setTaskData({ dealId: id, items })
      })
      .catch(() => setTaskData({ dealId: id, items: [] }))
  }, [])

  // Смена статуса задачи из drawer (быстрый statusOnly PUT). Права проверяем
  // на клиенте (инициатор/исполнитель) + сервер org-scoped.
  const setTaskStatus = (taskId: string, status: TaskStatus) => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: taskId, statusOnly: true, status }),
        })
        if (!res.ok) {
          toast.error("Не удалось изменить статус")
          return
        }
        if (dealId) reloadTasks(dealId)
        // Обновляем и доску (board intel) — карточка сразу подхватит задачу.
        onChanged()
      } catch {
        toast.error("Не удалось изменить статус")
      }
    })
  }

  // Открыть диалог связывания: подгрузить задачи ЭТОГО клиента, которые ещё
  // не привязаны к текущей сделке (кандидаты на привязку).
  const openLinkDialog = () => {
    if (!deal) return
    setLinkOpen(true)
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data: { tasks?: TaskRow[] }) => {
        setLinkCandidates(
          (data.tasks ?? []).filter(
            (t) => t.clientId === deal.clientId && t.dealId !== deal.id,
          ),
        )
      })
      .catch(() => setLinkCandidates([]))
  }

  // Привязать существующую задачу к сделке (PUT dealId).
  const linkTask = (taskId: string) => {
    if (!deal) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: taskId, dealId: deal.id }),
        })
        if (!res.ok) {
          toast.error("Не удалось связать задачу")
          return
        }
        toast.success("Задача связана со сделкой")
        setLinkOpen(false)
        reloadTasks(deal.id)
        onChanged()
      } catch {
        toast.error("Не удалось связать задачу")
      }
    })
  }

  useEffect(() => {
    if (!open || !dealId) return
    reloadTasks(dealId)
  }, [open, dealId, reloadTasks])

  // Стабильный prefill для «Новая задача по сделке» — иначе новая ссылка на
  // каждый рендер сбрасывала бы форму задачи при вводе (см. TaskEditDialog).
  const taskPrefill = useMemo(
    () => ({ dealId: deal?.id, clientId: deal?.clientId }),
    [deal?.id, deal?.clientId],
  )

  if (!deal) return null

  const isActive = deal.status === "active"
  const company = deal.clientName ?? deal.name
  const product = deal.clientName ? deal.name : null
  const amount = formatAmount(deal.value, deal.currency)
  const tasks = taskData && taskData.dealId === deal.id ? taskData.items : []
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
            {/* Бейдж этапа убран — ниже есть селект этапа с текущим значением. */}
            {deal.lastMovedBy === "agent" && (
              <Badge
                variant="secondary"
                className="gap-1 bg-violet-500/15 text-violet-600 dark:text-violet-300"
              >
                <Sparkles className="h-3 w-3" />
                перевёл агент
              </Badge>
            )}
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

        {/* Состояние сделки (UX №13): суть происходящего и что важно сейчас —
            чтобы быстро вспомнить контекст без чтения всей истории. Пока
            собирается из reasoning/changes (МОК summary); реальный текст
            генерирует LLM. TODO(backend): summary состояния сделки от LLM. */}
        {(deal.reasoning || deal.changes) && (
          <div className="mx-4 mt-3 rounded-lg border bg-violet-500/5 p-3 text-sm space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
              <Sparkles className="h-3.5 w-3.5" />
              Состояние сделки
            </div>
            {deal.reasoning && (
              <div className="whitespace-pre-wrap">{deal.reasoning}</div>
            )}
            {deal.changes && (
              <div>
                <div className="text-xs text-muted-foreground">
                  Последнее изменение
                </div>
                <div className="whitespace-pre-wrap">{deal.changes}</div>
              </div>
            )}
          </div>
        )}

        {/* Риск проигрыша (мок-инсайт) — отдельная плашка с причиной, как
            «Состояние сделки». TODO(backend): реальный сигнал риска. */}
        {isActive && mockAtRisk(deal.id) && (
          <div className="mx-4 mt-3 rounded-lg border border-[#C1121F]/20 bg-[#C1121F]/5 p-3 text-sm space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#A31018] dark:text-[#FF8F96]">
              <AlertTriangle className="h-3.5 w-3.5" />
              Риск проигрыша
            </div>
            <div>{mockRiskReason(deal.id)}</div>
          </div>
        )}

        <Tabs defaultValue="tasks" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-4 mt-3 w-fit">
            <TabsTrigger value="tasks">
              Задачи
              {tasks.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {tasks.length}
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
              // Создание задач в хронологии (по createdAt). Точное время
              // ПРИВЯЗКИ существующей задачи к сделке отдельно не журналируется
              // (TODO(backend): audit-log привязок) — в хронологии видно само
              // наличие задачи у сделки.
              for (const t of tasks) {
                events.push({
                  date: t.createdAt,
                  text: `Задача: ${t.name}`,
                  meta: `создана · ${TASK_TYPE_LABELS[t.type]}`,
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
            {/* Две кнопки: создать новую (dealId+клиент предзаполнены) и
                связать существующую задачу клиента с этой сделкой. */}
            <div className="grid grid-cols-2 gap-2">
              <TaskEditDialog
                mode="create"
                initialValues={taskPrefill}
                onSuccess={() => {
                  reloadTasks(deal.id)
                  onChanged()
                }}
                trigger={
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    Создать
                  </Button>
                }
              />
              <Button size="sm" variant="outline" onClick={openLinkDialog}>
                <Link2 className="h-4 w-4 mr-1" />
                Связать
              </Button>
            </div>
            {tasks.length === 0 ? (
              <div className="text-muted-foreground">Нет задач по сделке.</div>
            ) : (
              tasks.map((t) => {
                // Статус может менять инициатор (userId) или исполнитель.
                const canEdit =
                  currentUserId === t.userId || currentUserId === t.assigneeId
                return (
                  <div key={t.id} className="rounded-md border p-2.5 space-y-2.5">
                    <div className="min-w-0 space-y-1">
                      <div className="font-medium leading-snug">{t.name}</div>
                      {t.description && (
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                          {t.description}
                        </div>
                      )}
                    </div>
                    {/* Бейджи под заголовком: тип, приоритет, статус. */}
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary" className="text-[10px]">
                        {TASK_TYPE_LABELS[t.type]}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${TASK_PRIORITY_BADGE[t.priority]}`}
                      >
                        {TASK_PRIORITY_LABELS[t.priority]}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {TASK_STATUS_LABELS[t.status]}
                      </Badge>
                    </div>
                    {/* Мета-поля в две колонки — без «столбика» и пустоты справа. */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <TaskMeta label="Срок" value={formatDate(t.dueDate)} />
                      <TaskMeta label="Исполнитель" value={t.assigneeName} />
                      <TaskMeta label="Клиент" value={t.clientName} />
                      <TaskMeta label="Контакт" value={t.contactName} />
                    </div>
                    {/* Смена статуса — только инициатору/исполнителю. */}
                    {canEdit && (
                      <Select
                        value={t.status}
                        onValueChange={(v) => setTaskStatus(t.id, v as TaskStatus)}
                        disabled={isPending}
                      >
                        <SelectTrigger className="h-8 w-full">
                          <SelectValue placeholder="Изменить статус" />
                        </SelectTrigger>
                        <SelectContent>
                          {TASK_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {TASK_STATUS_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )
              })
            )}
          </TabsContent>
        </Tabs>

        {/* Происхождение (UX №14): не самая важная инфа — прибита к подвалу
            (shrink-0, вне скролла), аккуратный раскрывающийся блок со
            скруглениями в стиле продукта, по умолчанию закрыт, неяркий. */}
        {(() => {
          const origin = dealOriginMock(deal.id)
          return (
            <div className="shrink-0 border-t p-3">
              <details className="group rounded-lg border bg-muted/30 text-xs text-muted-foreground">
                <summary className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-3 py-2 font-medium hover:bg-muted/50">
                  Происхождение
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <div className="flex items-center gap-1.5 px-3 pb-2.5 pt-0.5">
                  <origin.Icon className="h-3.5 w-3.5 shrink-0" />
                  Создано {origin.label} · {formatDate(deal.createdAt)}
                </div>
              </details>
            </div>
          )
        })()}
      </SheetContent>

      {/* Диалог «Связать с задачей» (UX): задачи текущего клиента, ещё не
          привязанные к этой сделке; клик по строке привязывает. */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Связать задачу со сделкой</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-1">
            {linkCandidates.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Нет подходящих задач этого клиента.
              </div>
            ) : (
              linkCandidates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => linkTask(t.id)}
                  disabled={isPending}
                  className="w-full rounded-md border p-2.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <div className="font-medium leading-snug">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(t.dueDate)} · {TASK_TYPE_LABELS[t.type]} ·{" "}
                    {TASK_STATUS_LABELS[t.status]}
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}
