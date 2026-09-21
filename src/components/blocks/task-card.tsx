"use client"

import { useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { TaskRow } from "@/app/api/tasks/route"
import type { TaskType, TaskPriority, TaskStatus } from "@/db/schema"

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

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

// Клик по всей карточке открывает <TaskDetailDrawer> — как <ClientCard>, той
// же поверхностью (единый язык карточек по разделам). Отдельной кнопки
// редактирования больше нет; статус меняется прямо на карточке через Select,
// которая гасит всплытие клика, чтобы не открывать дровер по ошибке.
export function TaskCard({
  task,
  onChanged,
  onOpenDetail,
}: {
  task: TaskRow
  onChanged: () => void
  onOpenDetail: (taskId: string) => void
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
    <Card
      onClick={() => onOpenDetail(task.id)}
      className={cn(
        // Тот же белый фон, что у карточек сделок — единый язык карточек.
        "flex flex-col cursor-pointer bg-card border-border shadow-sm transition-[box-shadow,background-color] duration-200 hover:shadow-lg hover:bg-card dark:hover:bg-secondary",
      )}
    >
      <CardHeader>
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

        <div className="pt-1" onClick={stop} onPointerDown={stop}>
          <Select
            value={task.status}
            onValueChange={(v) => handleStatusChange(v as TaskStatus)}
            disabled={isPending}
          >
            <SelectTrigger size="sm" className="w-full text-xs">
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
