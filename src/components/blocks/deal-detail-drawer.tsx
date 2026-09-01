"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"
import { useForm } from "react-hook-form"
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Sparkles,
  Send,
  Mail,
  Phone,
  Plus,
  ChevronDown,
  Link2,
  AlertTriangle,
  Save,
} from "lucide-react"
import type { TaskStatus, DealStatus } from "@/db/schema"
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
import type {
  DealRow,
  DealFunnelStageOption,
  DealActivityRow,
  DealClientOption,
} from "@/app/api/deals/route"
import type { TaskRow } from "@/app/api/tasks/route"
import { dealStageLabel } from "@/lib/deal-funnel"
import { CURRENCY_SYMBOL } from "@/lib/deal-board"
import { DealInitiatorPopover } from "@/components/blocks/deal-initiator-popover"
import { DealContactsRoles } from "@/components/blocks/deal-contacts-roles"

// Тот же список, что раньше был в модалке-редакторе (form-deal-edit.tsx) —
// не импортируем оттуда, чтобы не тянуть create-only компонент ради одной
// константы после того, как edit-режим оттуда убран.
const DEAL_STATUS_OPTIONS: { value: DealStatus; label: string }[] = [
  { value: "active", label: "Активна" },
  { value: "cancelled", label: "Отменена (проиграна / отозвана)" },
  { value: "deleted", label: "Удалена (скрыта, исключена из поиска)" },
]

type DealEditFormData = {
  name: string
  description: string
  clientId: string
  value: string
  status: DealStatus
}

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
  clientOptions = [],
  currentUserId,
  open,
  onOpenChange,
  onChanged,
  onRequestStageChange,
}: {
  deal: DealRow | null
  stages: DealFunnelStageOption[]
  // Для инлайн-формы редактирования (Клиент-селект) — тот же массив, что
  // deals-board.tsx уже фетчит для формы создания сделки, доп. запрос не
  // нужен.
  clientOptions?: DealClientOption[]
  // Для прав смены статуса задачи (инициатор/исполнитель).
  currentUserId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  // Смена этапа из дровера идёт через ТОТ ЖЕ confirm/reason-диалог, что и
  // перетаскивание карточки на доске (deals-board.tsx уже владеет
  // pendingMove/pendingOutcome + DealMoveDialog/DealOutcomeDialog) — не
  // дублируем эту логику здесь и не переводим стадию в обход диалога.
  onRequestStageChange: (deal: DealRow, toStageId: string) => void
}) {
  // Стадию берём прямо из deal.funnelStageId — после перевода onChanged →
  // router.refresh обновляет проп (deal выводится из живого списка на доске).
  // Задачи храним вместе с их dealId, чтобы при переключении сделки сразу
  // показывать пустоту, а не задачи прошлой сделки (без синхронного setState).
  const [taskData, setTaskData] = useState<{
    dealId: string
    items: TaskRow[]
  } | null>(null)
  // Полная хронология сделки (deal_activity) — отдельно от задач, вкладка
  // «Хронология» показывает оба вперемешку по дате.
  const [activityData, setActivityData] = useState<{
    dealId: string
    items: DealActivityRow[]
  } | null>(null)
  const [isPending, startTransition] = useTransition()
  // Диалог «Связать с задачей»: задачи клиента без привязки к этой сделке.
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkCandidates, setLinkCandidates] = useState<TaskRow[]>([])
  // Попытка закрыть дровер (крестик/Esc/клик вовне) при несохранённой правке —
  // вместо тихого закрытия спрашиваем, что делать с изменениями.
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)

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

  const reloadActivity = useCallback((id: string) => {
    fetch(`/api/deals?activityFor=${id}`)
      .then((r) => r.json())
      .then((data: { activity?: DealActivityRow[] }) => {
        setActivityData({ dealId: id, items: data.activity ?? [] })
      })
      .catch(() => setActivityData({ dealId: id, items: [] }))
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

  // Перезагружаем хронологию не только при открытии, но и при любом
  // изменении updatedAt — перевод стадии могли сделать с доски (drag,
  // диалог, дропдаун этого же дровера), пока дровер открыт для этой сделки.
  useEffect(() => {
    if (!open || !dealId) return
    reloadActivity(dealId)
  }, [open, dealId, deal?.updatedAt, reloadActivity])

  // Стабильный prefill для «Новая задача по сделке» — иначе новая ссылка на
  // каждый рендер сбрасывала бы форму задачи при вводе (см. TaskEditDialog).
  const taskPrefill = useMemo(
    () => ({ dealId: deal?.id, clientId: deal?.clientId }),
    [deal?.id, deal?.clientId],
  )

  // Карточка подробностей слита с формой редактирования (было: read-only +
  // отдельная модалка `<DealEditDialog mode="edit">`) — все поля сразу
  // редактируемые, «Сохранить» пишет через PUT /api/deals. funnelStageId
  // сюда сознательно НЕ входит — этап меняется только через отдельный
  // Select ниже (handleStageChange → moveDealStage, с записью в журнал).
  const editForm = useForm<DealEditFormData>({
    defaultValues: {
      name: deal?.name ?? "",
      description: deal?.description ?? "",
      clientId: deal?.clientId ?? "",
      value: deal?.value ?? "",
      status: deal?.status ?? "active",
    },
  })
  const watchedClientId = editForm.watch("clientId")
  const currencySymbol =
    CURRENCY_SYMBOL[
      (clientOptions.find((c) => c.id === watchedClientId)?.currency ??
        "RUB"
      ).toUpperCase()
    ] ?? ""

  // Сброс формы ТОЛЬКО при смене сделки (deal?.id), не на каждый ре-рендер —
  // иначе фоновый refresh (кто-то перевёл ДРУГУЮ сделку → router.refresh() →
  // новые ссылки на все deal-объекты) стирал бы недосохранённый ввод.
  useEffect(() => {
    if (!deal) return
    editForm.reset({
      name: deal.name,
      description: deal.description ?? "",
      clientId: deal.clientId,
      value: deal.value ?? "",
      status: deal.status,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id])

  function onSaveDeal(data: DealEditFormData, opts?: { closeAfter?: boolean }) {
    if (!deal) return
    const trimmedValue = data.value.trim()
    const numericValue = trimmedValue === "" ? null : Number(trimmedValue)
    if (numericValue !== null && !Number.isFinite(numericValue)) {
      toast.error("Сумма должна быть числом")
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: deal.id,
            name: data.name,
            description: data.description,
            clientId: data.clientId,
            value: numericValue,
            status: data.status,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось сохранить сделку")
          return
        }
        toast.success("Сделка обновлена")
        // Сброс к только что сохранённым значениям — иначе isDirty остаётся
        // true (RHF сравнивает с исходным defaultValues, не с сервером), и
        // диалог «есть несохранённые изменения» ложно всплывал бы снова.
        editForm.reset(data)
        onChanged()
        if (opts?.closeAfter) onOpenChange(false)
      } catch {
        toast.error("Не удалось сохранить сделку")
      }
    })
  }

  function handleSheetOpenChange(next: boolean) {
    if (!next && editForm.formState.isDirty) {
      setConfirmCloseOpen(true)
      return
    }
    onOpenChange(next)
  }

  function discardAndClose() {
    if (deal) {
      editForm.reset({
        name: deal.name,
        description: deal.description ?? "",
        clientId: deal.clientId,
        value: deal.value ?? "",
        status: deal.status,
      })
    }
    setConfirmCloseOpen(false)
    onOpenChange(false)
  }

  if (!deal) return null

  const isActive = deal.status === "active"
  const tasks = taskData && taskData.dealId === deal.id ? taskData.items : []

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
        <SheetHeader className="p-4 pb-3 border-b space-y-3">
          {/* Карточка подробностей слита с формой редактирования — все поля
              сразу в режиме правки, «Сохранить» пишет через PUT /api/deals.
              Отдельной модалки-редактора для СУЩЕСТВУЮЩИХ сделок больше нет
              (карандаш на карточке и клик по карточке одинаково открывают
              этот дровер). funnelStageId сюда не входит — см. Select ниже. */}
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((data) => onSaveDeal(data))}
              className="space-y-3"
            >
              {/* Визуальный заголовок — само поле «Название», редактируемое.
                  sr-only SheetTitle остаётся для доступности (Radix Dialog
                  требует заголовок). pr-8, чтобы не залезать под крестик
                  закрытия. */}
              <SheetTitle className="sr-only">{deal.name}</SheetTitle>
              <div className="pr-8">
                <FormField
                  control={editForm.control}
                  name="name"
                  rules={{ required: "Укажите название" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          {...field}
                          className="text-base font-semibold border-none px-0 shadow-none focus-visible:ring-0 dark:bg-transparent selection:bg-muted-foreground/30 selection:text-inherit"
                          placeholder="Название сделки"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {(deal.userName || !!deal.contacts?.length) && (
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  {deal.userName ? <span>Автор: {deal.userName}</span> : <span />}
                  {!!deal.contacts?.length && (
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                      <span>Инициатор:</span>
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        {deal.contacts.map((c) => (
                          <DealInitiatorPopover
                            key={c.id}
                            contactId={c.id}
                            name={c.name}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <FormField
                control={editForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        placeholder="Описание (необязательно)"
                        className="text-sm"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Клиент/Сумма/Статус — единым столбиком (не в ряд): вместе с
                  Этапом раньше выходила запутанная сетка, где Этап (не часть
                  формы, применяется сразу) визуально путался со Статусом
                  (часть формы, применяется по «Сохранить»). Этап вынесен из
                  формы целиком — см. блок под «Состояние сделки» ниже. */}
              <FormField
                control={editForm.control}
                name="clientId"
                rules={{ required: "Укажите клиента" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Клиент
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите клиента" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {clientOptions.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Сумма
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          {currencySymbol}
                        </span>
                        <Input
                          className="pl-7"
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          placeholder="0"
                          {...field}
                        />
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Статус
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DEAL_STATUS_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              <div className="flex items-center justify-between gap-2">
                {deal.lastMovedBy === "agent" && (
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-violet-500/15 text-violet-600 dark:text-violet-300"
                  >
                    <Sparkles className="h-3 w-3" />
                    перевёл агент
                  </Badge>
                )}
                {/* size="default" (не "sm") — иначе высота кнопки не совпадала
                    с Select/Input рядом (sm = h-8, default = h-9, как у них). */}
                <Button
                  type="submit"
                  className="ml-auto"
                  disabled={isPending || !editForm.formState.isDirty}
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  Сохранить
                </Button>
              </div>
            </form>
          </Form>
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

        {/* Этап — вынесен из формы и из-под кнопки «Сохранить»: применяется
            СРАЗУ по выбору (не ждёт «Сохранить»), но не PUT-ом в обход
            диалогов — идёт через onRequestStageChange → deals-board.tsx,
            который заводит тот же confirm/reason-диалог (DealMoveDialog /
            DealOutcomeDialog), что и перетаскивание карточки на доске:
            обязательное обоснование для обратного перевода, подтверждение
            исхода при переводе в Closed/Rejected. */}
        <div className="mx-4 mt-3 space-y-2">
          <Label className="text-xs text-muted-foreground">Этап</Label>
          <Select
            value={deal.funnelStageId}
            onValueChange={(next) => onRequestStageChange(deal, next)}
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

        {/* Риск проигрыша (мок-инсайт) — отдельная плашка с причиной, как
            «Состояние сделки». TODO(backend): реальный сигнал риска. */}
        {isActive && mockAtRisk(deal.id) && (
          <div className="mx-4 mt-3 rounded-lg border border-[#C1121F]/20 bg-[#C1121F]/5 p-3 text-sm space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#A31018] dark:text-[#FF8F96]">
              <AlertTriangle className="h-3.5 w-3.5" />
              Есть риски
            </div>
            <div>{mockRiskReason(deal.id)}</div>
          </div>
        )}

        <Tabs defaultValue="tasks" className="flex-1 min-h-0 flex flex-col">
          <TabsList variant="line" className="mx-4 mt-3 w-fit">
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
              // Полная история — из deal_activity (журнал, пишется на каждое
              // создание/перевод, НИКОГДА не перезаписывается — в отличие от
              // deal.changes, которое живёт только на карточке). Причина
              // обратного перевода здесь ВИДНА (в отличие от карточки) — это
              // журнал, а не витрина текущего состояния.
              const activityItems =
                activityData && activityData.dealId === deal.id
                  ? activityData.items
                  : []
              const events: { date: string; text: string; meta?: string }[] =
                activityItems.map((a) => {
                  if (!a.fromStageName) {
                    return { date: a.createdAt, text: "Сделка создана" }
                  }
                  const move = `${dealStageLabel(a.fromStageName)} → ${dealStageLabel(a.toStageName ?? "")}`
                  const parts = [move]
                  if (a.note) parts.push(a.note)
                  if (a.actor === "agent" && a.reasoning) parts.push(a.reasoning)
                  return {
                    date: a.createdAt,
                    text: parts.join(" — "),
                    meta:
                      a.actor === "agent"
                        ? "перевёл агент"
                        : a.actorUserName
                          ? `перевёл: ${a.actorUserName}`
                          : "изменение",
                  }
                })
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

      {/* Попытка закрыть дровер с несохранённой правкой (крестик/Esc/клик
          вовне) — три исхода: сохранить и закрыть, отменить правку и
          закрыть, либо остаться в редактировании. */}
      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Есть несохранённые изменения</AlertDialogTitle>
            <AlertDialogDescription>
              Вы отредактировали сделку, но не нажали «Сохранить». Что сделать
              с изменениями?
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Короткие подписи (macOS/Chrome-паттерн Save/Don't Save/Cancel) —
              с полными "Продолжить редактирование"/"Отменить изменения" три
              кнопки не влезали в один ряд дефолтного footer и уезжали за
              край диалога. */}
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => setConfirmCloseOpen(false)}>
              Отмена
            </Button>
            <Button variant="outline" onClick={discardAndClose}>
              Не сохранять
            </Button>
            <Button
              disabled={isPending}
              onClick={() => {
                setConfirmCloseOpen(false)
                editForm.handleSubmit((data) =>
                  onSaveDeal(data, { closeAfter: true }),
                )()
              }}
            >
              Сохранить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}
