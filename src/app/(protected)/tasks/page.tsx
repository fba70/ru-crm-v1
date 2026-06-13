"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Loader, Plus, X } from "lucide-react"
import type {
  TaskRow,
  OrgMemberOption,
  TaskClientOption,
  TaskContactOption,
} from "@/app/api/tasks/route"
import type { TaskStatus, TaskType, TaskPriority } from "@/db/schema"
import TaskEditDialog from "@/components/forms/form-task-edit"
import { TaskCard } from "@/components/blocks/task-card"
import { TaskTimeline } from "@/components/blocks/task-timeline"

const PAGE_SIZE = 6

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "closed"]

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Выполнено",
  closed: "Закрыто",
}

const TYPES: TaskType[] = ["meet", "call", "email", "offer", "docs", "other"]
const TYPE_LABELS: Record<TaskType, string> = {
  meet: "Встреча",
  call: "Звонок",
  email: "Email",
  offer: "Предложение",
  docs: "Документы",
  other: "Другое",
}

const PRIORITIES: TaskPriority[] = ["low", "medium", "high"]
const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
}

const ALL = "__all__"

function usePaged<T>(items: T[]) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const effectivePage = Math.min(page, totalPages)
  const start = (effectivePage - 1) * PAGE_SIZE
  const pageItems = items.slice(start, start + PAGE_SIZE)
  return { page: effectivePage, setPage, totalPages, pageItems }
}

function PagerNav({
  page,
  totalPages,
  setPage,
}: {
  page: number
  totalPages: number
  setPage: (p: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            onClick={(e) => {
              e.preventDefault()
              if (page > 1) setPage(page - 1)
            }}
            aria-disabled={page === 1}
            className={
              page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"
            }
          />
        </PaginationItem>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
          <PaginationItem key={p}>
            <PaginationLink
              isActive={p === page}
              onClick={(e) => {
                e.preventDefault()
                setPage(p)
              }}
              className="cursor-pointer"
            >
              {p}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            onClick={(e) => {
              e.preventDefault()
              if (page < totalPages) setPage(page + 1)
            }}
            aria-disabled={page === totalPages}
            className={
              page === totalPages
                ? "pointer-events-none opacity-50"
                : "cursor-pointer"
            }
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

function StatusBucket({
  tasks,
  onChanged,
  emptyLabel,
}: {
  tasks: TaskRow[]
  onChanged: () => void
  emptyLabel: string
}) {
  const paged = usePaged(tasks)

  const grid = useMemo(
    () =>
      paged.pageItems.map((t) => (
        <TaskCard key={t.id} task={t} onChanged={onChanged} />
      )),
    [paged.pageItems, onChanged],
  )

  if (tasks.length === 0) {
    return <EmptyState label={emptyLabel} />
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{grid}</div>
      <div className="flex justify-center">
        <PagerNav
          page={paged.page}
          totalPages={paged.totalPages}
          setPage={paged.setPage}
        />
      </div>
    </div>
  )
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)

  const [members, setMembers] = useState<OrgMemberOption[]>([])
  const [clientOptions, setClientOptions] = useState<TaskClientOption[]>([])
  const [contactOptions, setContactOptions] = useState<TaskContactOption[]>([])

  const [nameFilter, setNameFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>(ALL)
  const [priorityFilter, setPriorityFilter] = useState<string>(ALL)
  const [assigneeFilter, setAssigneeFilter] = useState<string>(ALL)
  const [clientFilter, setClientFilter] = useState<string>(ALL)
  const [contactFilter, setContactFilter] = useState<string>(ALL)

  const refreshAll = useCallback(async () => {
    const res = await fetch("/api/tasks")
    const data = await res.json()
    setTasks(data.tasks ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [tasksRes, mRes, cRes, ctRes] = await Promise.all([
          fetch("/api/tasks").then((r) => r.json()),
          fetch("/api/tasks?members=1").then((r) => r.json()),
          fetch("/api/tasks?clientOptions=1").then((r) => r.json()),
          fetch("/api/tasks?contactOptions=1").then((r) => r.json()),
        ])
        if (cancelled) return
        setTasks(tasksRes.tasks ?? [])
        setMembers(mRes.members ?? [])
        setClientOptions(cRes.options ?? [])
        setContactOptions(ctRes.options ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredTasks = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase()
    return tasks.filter((t) => {
      if (needle && !t.name.toLowerCase().includes(needle)) return false
      if (typeFilter !== ALL && t.type !== typeFilter) return false
      if (priorityFilter !== ALL && t.priority !== priorityFilter) return false
      if (assigneeFilter !== ALL && t.assigneeId !== assigneeFilter)
        return false
      if (clientFilter !== ALL && (t.clientId ?? "") !== clientFilter)
        return false
      if (contactFilter !== ALL && (t.contactId ?? "") !== contactFilter)
        return false
      return true
    })
  }, [
    tasks,
    nameFilter,
    typeFilter,
    priorityFilter,
    assigneeFilter,
    clientFilter,
    contactFilter,
  ])

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, TaskRow[]> = {
      todo: [],
      in_progress: [],
      done: [],
      closed: [],
    }
    for (const t of filteredTasks) map[t.status].push(t)
    return map
  }, [filteredTasks])

  const hasActiveFilters =
    nameFilter.trim() !== "" ||
    typeFilter !== ALL ||
    priorityFilter !== ALL ||
    assigneeFilter !== ALL ||
    clientFilter !== ALL ||
    contactFilter !== ALL

  const clearFilters = () => {
    setNameFilter("")
    setTypeFilter(ALL)
    setPriorityFilter(ALL)
    setAssigneeFilter(ALL)
    setClientFilter(ALL)
    setContactFilter(ALL)
  }

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">ЗАДАЧИ</h1>

      <Card className="w-full max-w-7xl">
        <CardHeader>
          <CardTitle>Канбан-доска</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-3">
            <TaskEditDialog
              mode="create"
              onSuccess={refreshAll}
              trigger={
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Новая задача
                </Button>
              }
            />
          </div>

          <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <Input
              placeholder="Поиск по названию…"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
            />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full justify-center">
                <SelectValue placeholder="Тип" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все типы</SelectItem>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full justify-center">
                <SelectValue placeholder="Приоритет" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все приоритеты</SelectItem>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="w-full justify-center">
                <SelectValue placeholder="Исполнитель" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все исполнители</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-full justify-center">
                <SelectValue placeholder="Клиент" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все клиенты</SelectItem>
                {clientOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={contactFilter} onValueChange={setContactFilter}>
              <SelectTrigger className="w-full justify-center">
                <SelectValue placeholder="Контакт" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все контакты</SelectItem>
                {contactOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {filteredTasks.length} из {tasks.length} задач
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
            >
              <X className="h-4 w-4 mr-1" />
              Сбросить фильтры
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="animate-spin h-6 w-6" />
            </div>
          ) : (
            <Tabs defaultValue="todo" className="w-full">
              <TabsList>
                {STATUSES.map((s) => (
                  <TabsTrigger key={s} value={s}>
                    {STATUS_LABELS[s]}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      ({byStatus[s].length})
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
              {STATUSES.map((s) => (
                <TabsContent key={s} value={s} className="mt-4">
                  <StatusBucket
                    tasks={byStatus[s]}
                    onChanged={refreshAll}
                    emptyLabel={
                      hasActiveFilters
                        ? `Нет задач по фильтрам в «${STATUS_LABELS[s]}».`
                        : `Нет задач в «${STATUS_LABELS[s]}».`
                    }
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>

      <Card className="w-full max-w-7xl">
        <CardHeader>
          <CardTitle>Хронология</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="animate-spin h-6 w-6" />
            </div>
          ) : (
            <TaskTimeline tasks={filteredTasks} onChanged={refreshAll} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <Card className="border-dashed bg-muted/50 dark:bg-muted/30 border-muted">
      <CardHeader>
        <CardTitle className="text-base text-muted-foreground font-normal text-center">
          {label}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}
