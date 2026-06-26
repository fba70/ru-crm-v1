"use client"

import { useState, useTransition, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/blocks/loading-button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import { toast } from "sonner"
import type {
  TaskRow,
  OrgMemberOption,
  TaskClientOption,
  TaskContactOption,
} from "@/app/api/tasks/route"
import type { TaskType, TaskPriority, TaskStatus } from "@/db/schema"

const TYPES: TaskType[] = [
  "meet",
  "call",
  "email",
  "offer",
  "docs",
  "support",
  "other",
]
const PRIORITIES: TaskPriority[] = ["low", "medium", "high"]
const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "closed"]

const TYPE_LABELS: Record<TaskType, string> = {
  meet: "Встреча",
  call: "Звонок",
  email: "Email",
  offer: "Предложение",
  docs: "Документы",
  support: "Поддержка",
  other: "Другое",
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Выполнено",
  closed: "Закрыто",
}

const NO_CLIENT = "__none__"
const NO_CONTACT = "__none__"

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return new Date().toISOString().slice(0, 10)
  return new Date(iso).toISOString().slice(0, 10)
}

type TaskFormData = {
  name: string
  description: string
  type: TaskType
  priority: TaskPriority
  status: TaskStatus
  assigneeId: string
  clientId: string
  contactId: string
  dueDate: string
}

type Props = {
  mode: "create" | "edit"
  task?: TaskRow
  trigger: React.ReactNode
  onSuccess?: () => void
  // Create-mode-only prefill (ignored in edit mode, where `task` wins).
  // Used e.g. by the dashboard cards "Принять" → "create task from card" flow.
  // Pass a stable reference (memoize in the parent) so the open-effect's
  // form.reset doesn't re-run and wipe edits while the dialog is open.
  initialValues?: Partial<TaskFormData>
}

export default function TaskEditDialog({
  mode,
  task,
  trigger,
  onSuccess,
  initialValues,
}: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [members, setMembers] = useState<OrgMemberOption[]>([])
  const [clientOptions, setClientOptions] = useState<TaskClientOption[]>([])
  const [contactOptions, setContactOptions] = useState<TaskContactOption[]>([])

  // Defaults resolve edit-mode `task` first, then create-mode `initialValues`,
  // then hardcoded fallbacks — so a prefilled create (e.g. from a card) seeds
  // the form while edit mode is unaffected.
  const buildDefaults = useCallback(
    (): TaskFormData => ({
      name: task?.name ?? initialValues?.name ?? "",
      description: task?.description ?? initialValues?.description ?? "",
      type: task?.type ?? initialValues?.type ?? "other",
      priority: task?.priority ?? initialValues?.priority ?? "medium",
      status: task?.status ?? initialValues?.status ?? "todo",
      assigneeId: task?.assigneeId ?? initialValues?.assigneeId ?? "",
      clientId: task?.clientId ?? initialValues?.clientId ?? NO_CLIENT,
      contactId: task?.contactId ?? initialValues?.contactId ?? NO_CONTACT,
      dueDate: task?.dueDate
        ? toDateInput(task.dueDate)
        : initialValues?.dueDate ?? toDateInput(undefined),
    }),
    [task, initialValues],
  )

  const form = useForm<TaskFormData>({ defaultValues: buildDefaults() })

  const watchedClientId = form.watch("clientId")

  useEffect(() => {
    if (!open) return
    form.reset(buildDefaults())

    let cancelled = false
    ;(async () => {
      try {
        const [mRes, cRes] = await Promise.all([
          fetch("/api/tasks?members=1").then((r) => r.json()),
          fetch("/api/tasks?clientOptions=1").then((r) => r.json()),
        ])
        if (cancelled) return
        const loadedMembers: OrgMemberOption[] = mRes.members ?? []
        setMembers(loadedMembers)
        setClientOptions(cRes.options ?? [])
        if (mode === "create" && !form.getValues("assigneeId")) {
          const me = loadedMembers[0]
          if (me) form.setValue("assigneeId", me.id)
        }
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [open, task, form, mode, buildDefaults])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const qs =
      watchedClientId && watchedClientId !== NO_CLIENT
        ? `?contactOptions=1&clientId=${encodeURIComponent(watchedClientId)}`
        : "?contactOptions=1"
    ;(async () => {
      try {
        const res = await fetch(`/api/tasks${qs}`).then((r) => r.json())
        if (cancelled) return
        const options: TaskContactOption[] = res.options ?? []
        setContactOptions(options)
        const currentContact = form.getValues("contactId")
        if (currentContact !== NO_CONTACT) {
          const stillValid = options.some((o) => o.id === currentContact)
          if (!stillValid) form.setValue("contactId", NO_CONTACT)
        }
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [open, watchedClientId, form])

  const onSubmit = (data: TaskFormData) => {
    startTransition(async () => {
      try {
        const clientId = data.clientId === NO_CLIENT ? null : data.clientId
        const contactId = data.contactId === NO_CONTACT ? null : data.contactId
        const payload =
          mode === "create"
            ? { ...data, clientId, contactId }
            : { id: task!.id, ...data, clientId, contactId }
        const res = await fetch("/api/tasks", {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось сохранить задачу")
          return
        }
        toast.success(mode === "create" ? "Задача создана" : "Задача обновлена")
        onSuccess?.()
        setOpen(false)
      } catch {
        toast.error("Не удалось сохранить задачу")
      }
    })
  }

  const title =
    mode === "create"
      ? "Новая задача"
      : `Редактирование задачи: ${task?.name ?? ""}`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              rules={{ required: "Укажите название" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Название *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Название задачи" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Описание</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Необязательные детали…"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Тип</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Приоритет</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {PRIORITY_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Статус</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="assigneeId"
                rules={{ required: "Укажите исполнителя" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Исполнитель</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите исполнителя" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueDate"
                rules={{ required: "Укажите срок" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Срок</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Клиент</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v)
                        form.setValue("contactId", NO_CONTACT)
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Без клиента" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_CLIENT}>Без клиента</SelectItem>
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
                control={form.control}
                name="contactId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Контакт</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Без контакта" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_CONTACT}>Без контакта</SelectItem>
                        {contactOptions.map((c) => (
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
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Отмена
              </Button>
              <LoadingButton type="submit" loading={isPending}>
                {mode === "create" ? "Создать" : "Сохранить"}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
