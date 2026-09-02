// Русские лейблы + порядок значений для задач. Единый источник, чтобы
// карточка сделки, drawer и страница «Задачи» не расходились в подписях.
import type { TaskStatus, TaskType, TaskPriority } from "@/db/schema"

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Выполнено",
  closed: "Закрыто",
}
export const TASK_STATUSES: TaskStatus[] = [
  "todo",
  "in_progress",
  "done",
  "closed",
]

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  meet: "Встреча",
  call: "Звонок",
  email: "Email",
  offer: "Предложение",
  docs: "Документы",
  support: "Поддержка",
  other: "Другое",
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
}

// Цвет бейджа приоритета (в палитре: high = warn-red, medium/low — нейтрально).
export const TASK_PRIORITY_BADGE: Record<TaskPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-[#669BBC]/15 text-[#2F5D77] dark:text-[#9FC4DC]",
  high: "bg-[#C1121F]/12 text-[#A31018] dark:text-[#FF8F96]",
}

// Цвет бейджа статуса выполнения — единый источник для всего продукта
// (карточка сделки/drawer и любые будущие места, где показывается статус
// задачи бейджем), чтобы не расходились в разных местах.
export const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  todo: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  in_progress: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  closed: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400",
}
