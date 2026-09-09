"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
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
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Globe, Pencil, Plus, Save } from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  TASK_TYPE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_BADGE,
  TASK_STATUS_BADGE,
} from "@/lib/task-labels"
import TaskEditDialog from "@/components/forms/form-task-edit"
import ContactEditDialog from "@/components/forms/form-contact-edit"
import { ClientLookupDialog } from "@/components/blocks/client-lookup-dialog"
import { ClientContentTable } from "@/components/blocks/client-content-table"
import type { TaskStatus, EntityStatus, FunnelPhase } from "@/db/schema"
import type { ClientRow } from "@/app/api/clients/route"
import type { TaskRow } from "@/app/api/tasks/route"
import type { ContactRow } from "@/app/api/contacts/route"
import type { SourceSummary } from "@/server/sources"
import {
  CLIENT_TYPE_LABELS,
  CLIENT_TYPE_VALUES,
  COMPANY_KIND_LABELS,
  COMPANY_KIND_VALUES,
  orgHasStructuredClientType,
  type ClientType,
  type CompanyKind,
} from "@/lib/client-custom-fields"

const TYPE_NONE = "__none__"
const COMPANY_KIND_NONE = "__none__"

const STATUS_OPTIONS: { value: EntityStatus; label: string }[] = [
  { value: "active", label: "Активный" },
  { value: "initial", label: "Новый" },
  { value: "suspended", label: "Приостановлен" },
  { value: "deleted", label: "Удалён" },
  { value: "blocked", label: "Заблокирован" },
]
const PHASE_OPTIONS: { value: FunnelPhase; label: string }[] = [
  { value: "awareness", label: "Осведомлённость" },
  { value: "interest", label: "Интерес" },
  { value: "decision", label: "Решение" },
  { value: "action", label: "Действие" },
  { value: "retention", label: "Удержание" },
]
const CURRENCIES: { value: string; label: string }[] = [
  { value: "RUB", label: "₽ RUB" },
  { value: "USD", label: "$ USD" },
  { value: "EUR", label: "€ EUR" },
  { value: "GBP", label: "£ GBP" },
  { value: "CNY", label: "¥ CNY" },
]

type ClientEditFormData = {
  name: string
  namePhys: string
  comment: string
  aliases: string
  phone: string
  email: string
  address: string
  webUrl: string
  type: ClientType | typeof TYPE_NONE
  discount: string
  companyKind: CompanyKind | typeof COMPANY_KIND_NONE
  funnelPhase: FunnelPhase
  status: EntityStatus
  currency: string
}

function buildDefaults(client: ClientRow | null): ClientEditFormData {
  return {
    name: client?.name ?? "",
    namePhys: client?.namePhys ?? "",
    comment: client?.comment ?? "",
    aliases: (client?.aliases ?? []).join(", "),
    phone: client?.phone ?? "",
    email: client?.email ?? "",
    address: client?.address ?? "",
    webUrl: client?.webUrl ?? "",
    type: client?.customFields?.type ?? TYPE_NONE,
    discount:
      client?.customFields?.discount != null
        ? String(client.customFields.discount)
        : "",
    companyKind: client?.customFields?.companyKind ?? COMPANY_KIND_NONE,
    funnelPhase: client?.funnelPhase ?? "awareness",
    status: client?.status ?? "active",
    currency: client?.currency ?? "RUB",
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

// Одно мета-поле задачи в HoverCard — как в deal-detail-drawer.tsx.
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

// Ресайзер ширины дровера драг-н-дропом. Нативного примитива для этого нет
// ни в Radix, ни в shadcn Sheet — react-resizable-panels (уже зависимость
// проекта) устроен для разбиения ДОСТУПНОГО пространства между соседними
// панелями в потоке документа, а не для растягивания floating-оверлея
// поверх вьюпорта, так что он тут не подходит. Небольшой ручной хэндлер —
// стандартный путь для именно этого случая.
const MIN_WIDTH = 480
const MAX_WIDTH = 1100
const DEFAULT_WIDTH = 720
const WIDTH_STORAGE_KEY = "client-drawer-width"

function useDrawerWidth() {
  // Lazy initializer (not an effect) — localStorage is a synchronous,
  // side-effect-free read, so this is the documented React pattern for
  // seeding state from an external source without an extra render pass.
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
      if (Number.isFinite(stored) && stored > 0) {
        return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, stored))
      }
    } catch {
      /* localStorage unavailable — keep default */
    }
    return DEFAULT_WIDTH
  })
  const draggingRef = useRef(false)

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"

    function onMove(ev: PointerEvent) {
      if (!draggingRef.current) return
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, window.innerWidth - ev.clientX),
      )
      setWidth(next)
    }
    function onUp() {
      draggingRef.current = false
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_STORAGE_KEY, String(w))
        } catch {
          /* ignore */
        }
        return w
      })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }, [])

  return { width, onResizeStart }
}

export function ClientDetailDrawer({
  client,
  open,
  onOpenChange,
  onChanged,
}: {
  client: ClientRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user.id
  const router = useRouter()
  const { width, onResizeStart } = useDrawerWidth()

  const [taskData, setTaskData] = useState<{
    clientId: string
    items: TaskRow[]
  } | null>(null)
  const [sources, setSources] = useState<SourceSummary[]>([])
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const clientId = client?.id
  const showTypeField = orgHasStructuredClientType(client?.organizationId)

  const reloadTasks = useCallback((id: string) => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data: { tasks?: TaskRow[] }) => {
        const items = (data.tasks ?? [])
          .filter((t) => t.clientId === id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        setTaskData({ clientId: id, items })
      })
      .catch(() => setTaskData({ clientId: id, items: [] }))
  }, [])

  useEffect(() => {
    if (!open || !clientId) return
    reloadTasks(clientId)
  }, [open, clientId, reloadTasks])

  // Список источников для селектора в «Материалах компании» — один раз на
  // открытие, тот же эндпоинт, что уже использует ExploreSourcesDialog.
  useEffect(() => {
    if (!open) return
    fetch("/api/sources/options")
      .then((r) => r.json())
      .then((d: { sources?: SourceSummary[] }) => setSources(d.sources ?? []))
      .catch(() => setSources([]))
  }, [open])

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
        if (clientId) reloadTasks(clientId)
        onChanged()
      } catch {
        toast.error("Не удалось изменить статус")
      }
    })
  }

  const openEditContact = (contactId: string) => {
    fetch(`/api/contacts?id=${encodeURIComponent(contactId)}`)
      .then((r) => r.json())
      .then((data: { contact?: ContactRow }) => {
        if (data.contact) setEditingContact(data.contact)
      })
      .catch(() => {})
  }

  const editForm = useForm<ClientEditFormData>({
    defaultValues: buildDefaults(client),
  })

  // Сброс формы ТОЛЬКО при смене компании — иначе фоновый refresh (кто-то
  // изменил ДРУГУЮ карточку → новые ссылки на все client-объекты) стирал бы
  // недосохранённый ввод. Тот же паттерн, что deal-detail-drawer.tsx.
  useEffect(() => {
    if (!client) return
    editForm.reset(buildDefaults(client))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id])

  function onSave(data: ClientEditFormData, opts?: { closeAfter?: boolean }) {
    if (!client) return
    const aliases = data.aliases
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
    const discountValue =
      data.discount.trim() === "" ? undefined : Number(data.discount)
    const customFields = {
      ...(client.customFields ?? {}),
      type: data.type === TYPE_NONE ? undefined : data.type,
      discount: discountValue,
      companyKind:
        data.companyKind === COMPANY_KIND_NONE ? undefined : data.companyKind,
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/clients", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: client.id,
            name: data.name,
            namePhys: data.namePhys,
            comment: data.comment,
            aliases,
            phone: data.phone,
            email: data.email,
            address: data.address,
            webUrl: data.webUrl,
            customFields,
            funnelPhase: data.funnelPhase,
            status: data.status,
            currency: data.currency,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось сохранить компанию")
          return
        }
        toast.success("Компания обновлена")
        editForm.reset(data)
        onChanged()
        if (opts?.closeAfter) onOpenChange(false)
      } catch {
        toast.error("Не удалось сохранить компанию")
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
    if (client) editForm.reset(buildDefaults(client))
    setConfirmCloseOpen(false)
    onOpenChange(false)
  }

  if (!client) return null

  const tasks = taskData && taskData.clientId === client.id ? taskData.items : []

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        className="w-full flex flex-col gap-0 p-0"
        style={{ width: `${width}px`, maxWidth: "none" }}
      >
        {/* Ресайзер: тонкая полоса на левом краю, драг двигает край панели. */}
        <div
          onPointerDown={onResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину панели"
          className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none hover:bg-[#669BBC]/40"
        />
        <SheetHeader className="p-4 pb-3 border-b space-y-3">
          {/* Карточка подробностей = форма редактирования, по образцу
              deal-detail-drawer.tsx: все поля сразу редактируемые,
              «Сохранить» пишет через PUT /api/clients. Карандаш с карточки
              списка убран — клик по карточке и открывает этот же дровер. */}
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((data) => onSave(data))}
              className="space-y-3"
            >
              <SheetTitle className="sr-only">{client.name}</SheetTitle>
              <div className="flex items-start gap-2 pr-8">
                <div className="min-w-0 flex-1">
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
                            placeholder="Название компании"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <ClientLookupDialog
                  client={client}
                  onSaved={onChanged}
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Поиск в интернете"
                      title="Поиск в интернете"
                    >
                      <Globe className="h-4 w-4" />
                    </Button>
                  }
                />
              </div>

              {client.userName && (
                <div className="text-sm text-muted-foreground">
                  Создал: {client.userName}
                </div>
              )}

              <FormField
                control={editForm.control}
                name="namePhys"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      ФИО физлица
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Если это не организация"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={editForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Телефон
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="+7 999 000 0000" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Email
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          placeholder="hello@example.com"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={editForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Адрес
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Улица, город, страна" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="webUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Сайт
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://example.com" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="aliases"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Другие названия
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Через запятую (напр. AST, АСТ)"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="comment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Комментарий
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        placeholder="Заметки, помогающие опознать компанию"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={editForm.control}
                  name="discount"
                  rules={{
                    validate: (v) => {
                      const s = v.trim()
                      if (s === "") return true
                      const n = Number(s)
                      return (
                        (Number.isFinite(n) && n >= 0 && n <= 100) ||
                        "0–100"
                      )
                    },
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Скидка (%)
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          inputMode="numeric"
                          placeholder="напр. 20"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="companyKind"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Тип компании
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Не определено" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={COMPANY_KIND_NONE}>
                            Не определено (по сделкам)
                          </SelectItem>
                          {COMPANY_KIND_VALUES.map((k) => (
                            <SelectItem key={k} value={k}>
                              {COMPANY_KIND_LABELS[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              {showTypeField && (
                <FormField
                  control={editForm.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Тип
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите тип" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={TYPE_NONE}>—</SelectItem>
                          {CLIENT_TYPE_VALUES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {CLIENT_TYPE_LABELS[t]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              )}

              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={editForm.control}
                  name="funnelPhase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Этап воронки
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PHASE_OPTIONS.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Валюта
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CURRENCIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex items-center justify-end">
                <Button
                  type="submit"
                  disabled={isPending || !editForm.formState.isDirty}
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  Сохранить
                </Button>
              </div>
            </form>
          </Form>
        </SheetHeader>

        <div className="flex flex-1 min-h-0 flex-col px-4">
          <Tabs defaultValue="tasks" className="flex-1 min-h-0 flex flex-col">
            <TabsList
              variant="line"
              className="mt-3 w-full justify-between border-b"
            >
              <TabsTrigger value="tasks" className="flex-none">
                Задачи
                {tasks.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {tasks.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="contacts" className="flex-none">
                Контакты
                {client.contacts.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {client.contacts.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="content" className="flex-none">
                Материалы компании
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="tasks"
              className="flex-1 min-h-0 overflow-y-auto py-4 space-y-2 text-sm"
            >
              <TaskEditDialog
                mode="create"
                initialValues={{ clientId: client.id }}
                onSuccess={() => {
                  reloadTasks(client.id)
                  onChanged()
                }}
                trigger={
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    Создать
                  </Button>
                }
              />
              {tasks.length === 0 ? (
                <div className="text-muted-foreground">
                  Нет задач по компании.
                </div>
              ) : (
                tasks.map((t) => {
                  const canEdit =
                    currentUserId === t.userId || currentUserId === t.assigneeId
                  return (
                    <HoverCard key={t.id} openDelay={200}>
                      <HoverCardTrigger asChild>
                        <div
                          className="cursor-pointer space-y-2 rounded-md border p-2.5 transition-colors hover:bg-accent/50"
                          onClick={() => router.push(`/tasks?openTask=${t.id}`)}
                        >
                          <div className="max-w-[32rem] font-medium leading-snug">
                            {t.name}
                          </div>
                          <div className="flex items-center justify-between gap-2">
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
                              <Badge
                                variant="secondary"
                                className={`text-[10px] ${TASK_STATUS_BADGE[t.status]}`}
                              >
                                {TASK_STATUS_LABELS[t.status]}
                              </Badge>
                            </div>
                            {canEdit && (
                              <Select
                                value={t.status}
                                onValueChange={(v) =>
                                  setTaskStatus(t.id, v as TaskStatus)
                                }
                                disabled={isPending}
                              >
                                <SelectTrigger
                                  className="h-7 w-auto shrink-0 text-xs"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <SelectValue />
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
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent className="w-80 space-y-2 text-sm">
                        <div className="font-medium leading-snug">{t.name}</div>
                        {t.description && (
                          <div className="whitespace-pre-wrap text-xs text-muted-foreground">
                            {t.description}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                          <TaskMeta label="Срок" value={formatDate(t.dueDate)} />
                          <TaskMeta
                            label="Исполнитель"
                            value={t.assigneeName}
                          />
                          <TaskMeta label="Сделка" value={t.dealName} />
                          <TaskMeta label="Контакт" value={t.contactName} />
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  )
                })
              )}
            </TabsContent>

            <TabsContent
              value="contacts"
              className="flex-1 min-h-0 overflow-y-auto py-4 space-y-2 text-sm"
            >
              <ContactEditDialog
                mode="create"
                defaultClientId={client.id}
                onSuccess={onChanged}
                trigger={
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    Новый контакт
                  </Button>
                }
              />
              {client.contacts.length === 0 ? (
                <div className="text-muted-foreground">
                  К этой компании ещё не привязаны контакты.
                </div>
              ) : (
                client.contacts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-md border p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium leading-snug">
                        {c.nameNative || c.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[c.position, c.email, c.phone]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label="Редактировать контакт"
                      onClick={() => openEditContact(c.id)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent
              value="content"
              className="flex-1 min-h-0 overflow-y-auto py-4 text-sm"
            >
              <ClientContentTable clientId={client.id} sources={sources} />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>

      {editingContact && (
        <ContactEditDialog
          mode="edit"
          contact={editingContact}
          trigger={<span hidden />}
          open={Boolean(editingContact)}
          onOpenChange={(o) => {
            if (!o) setEditingContact(null)
          }}
          onSuccess={() => {
            setEditingContact(null)
            onChanged()
          }}
        />
      )}

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Есть несохранённые изменения</AlertDialogTitle>
            <AlertDialogDescription>
              Вы отредактировали компанию, но не нажали «Сохранить». Что
              сделать с изменениями?
            </AlertDialogDescription>
          </AlertDialogHeader>
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
                  onSave(data, { closeAfter: true }),
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
