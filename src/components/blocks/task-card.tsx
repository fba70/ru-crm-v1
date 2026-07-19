"use client"

import { useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CalendarClock,
  User as UserIcon,
  Building2,
  Contact as ContactIcon,
  Handshake,
  Pencil,
} from "lucide-react"
import { toast } from "sonner"
import type { TaskRow } from "@/app/api/tasks/route"
import type { TaskType, TaskPriority, TaskStatus } from "@/db/schema"
import TaskEditDialog from "@/components/forms/form-task-edit"

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

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "closed"]

const TYPE_COLOR: Record<TaskType, string> = {
  meet: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  call: "bg-green-500/15 text-green-600 dark:text-green-300",
  email: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  offer: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  docs: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  support: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  other: "bg-gray-500/15 text-gray-600 dark:text-gray-300",
}

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  medium: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  high: "bg-red-500/15 text-red-600 dark:text-red-300",
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function TaskCard({
  task,
  onChanged,
}: {
  task: TaskRow
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()

  const handleStatusChange = (next: TaskStatus) => {
    if (next === task.status) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: task.id,
            statusOnly: true,
            status: next,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось обновить статус")
          return
        }
        toast.success(`Перемещено: ${STATUS_LABELS[next]}`)
        onChanged()
      } catch {
        toast.error("Не удалось обновить статус")
      }
    })
  }

  return (
    <Card className="flex flex-col bg-muted/50 dark:bg-muted/30 border-muted dark:border-gray-600">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{task.name}</CardTitle>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge className={TYPE_COLOR[task.type]} variant="secondary">
              {TYPE_LABELS[task.type]}
            </Badge>
            <Badge
              className={PRIORITY_COLOR[task.priority]}
              variant="secondary"
            >
              {PRIORITY_LABELS[task.priority]}
            </Badge>
          </div>
        </div>
        <TaskEditDialog
          mode="edit"
          task={task}
          onSuccess={onChanged}
          trigger={
            <Button variant="ghost" size="icon" aria-label="Редактировать задачу">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="flex-1 space-y-3 text-sm">
        {task.description && (
          <p className="text-muted-foreground line-clamp-3 whitespace-pre-wrap">
            {task.description}
          </p>
        )}

        <div className="space-y-1 text-muted-foreground">
          <div className="flex items-center gap-2 truncate">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Срок {formatDate(task.dueDate)}</span>
          </div>
          <div className="flex items-center gap-2 truncate">
            <UserIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {task.assigneeName ?? "Без исполнителя"}
            </span>
          </div>
          {task.clientName && (
            <div className="flex items-center gap-2 truncate">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{task.clientName}</span>
            </div>
          )}
          {task.contactName && (
            <div className="flex items-center gap-2 truncate">
              <ContactIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{task.contactName}</span>
            </div>
          )}
          {task.dealName && (
            <div className="flex items-center gap-2 truncate">
              <Handshake className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{task.dealName}</span>
            </div>
          )}
        </div>

        <div className="pt-1">
          <Select
            value={task.status}
            onValueChange={(v) => handleStatusChange(v as TaskStatus)}
            disabled={isPending}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  Перенести: {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {task.userName && (
          <div className="text-xs text-muted-foreground pt-1">
            Создал {task.userName}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
