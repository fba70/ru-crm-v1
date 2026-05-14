"use client"

import { useState, useTransition, useEffect } from "react"
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

const TYPES: TaskType[] = ["meet", "call", "email", "offer", "docs", "other"]
const PRIORITIES: TaskPriority[] = ["low", "medium", "high"]
const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "closed"]

const TYPE_LABELS: Record<TaskType, string> = {
  meet: "Meet",
  call: "Call",
  email: "Email",
  offer: "Offer",
  docs: "Docs",
  other: "Other",
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
  closed: "Closed",
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
}

export default function TaskEditDialog({
  mode,
  task,
  trigger,
  onSuccess,
}: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [members, setMembers] = useState<OrgMemberOption[]>([])
  const [clientOptions, setClientOptions] = useState<TaskClientOption[]>([])
  const [contactOptions, setContactOptions] = useState<TaskContactOption[]>([])

  const form = useForm<TaskFormData>({
    defaultValues: {
      name: task?.name ?? "",
      description: task?.description ?? "",
      type: task?.type ?? "other",
      priority: task?.priority ?? "medium",
      status: task?.status ?? "todo",
      assigneeId: task?.assigneeId ?? "",
      clientId: task?.clientId ?? NO_CLIENT,
      contactId: task?.contactId ?? NO_CONTACT,
      dueDate: toDateInput(task?.dueDate),
    },
  })

  const watchedClientId = form.watch("clientId")

  useEffect(() => {
    if (!open) return
    form.reset({
      name: task?.name ?? "",
      description: task?.description ?? "",
      type: task?.type ?? "other",
      priority: task?.priority ?? "medium",
      status: task?.status ?? "todo",
      assigneeId: task?.assigneeId ?? "",
      clientId: task?.clientId ?? NO_CLIENT,
      contactId: task?.contactId ?? NO_CONTACT,
      dueDate: toDateInput(task?.dueDate),
    })

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
  }, [open, task, form, mode])

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
          toast.error(err.error || "Failed to save task")
          return
        }
        toast.success(mode === "create" ? "Task created" : "Task updated")
        onSuccess?.()
        setOpen(false)
      } catch {
        toast.error("Failed to save task")
      }
    })
  }

  const title =
    mode === "create" ? "New task" : `Edit task: ${task?.name ?? ""}`

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
              rules={{ required: "Name is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Task name" />
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
                  <FormLabel className="text-gray-400">Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Optional details…"
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
                    <FormLabel className="text-gray-400">Type</FormLabel>
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
                    <FormLabel className="text-gray-400">Priority</FormLabel>
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
                    <FormLabel className="text-gray-400">Status</FormLabel>
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
                rules={{ required: "Assignee is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Assignee</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select assignee" />
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
                rules={{ required: "Due date is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Due date</FormLabel>
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
                    <FormLabel className="text-gray-400">Client</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v)
                        form.setValue("contactId", NO_CONTACT)
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No client" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_CLIENT}>No client</SelectItem>
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
                    <FormLabel className="text-gray-400">Contact</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No contact" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_CONTACT}>No contact</SelectItem>
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
                Cancel
              </Button>
              <LoadingButton type="submit" loading={isPending}>
                {mode === "create" ? "Create" : "Save"}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
