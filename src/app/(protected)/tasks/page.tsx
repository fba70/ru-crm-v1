"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { AlertTriangle, Loader, Plus, Rows4, PlayingCardsFan, X } from "lucide-react"
import type {
  TaskRow,
  OrgMemberOption,
  TaskClientOption,
  TaskContactOption,
} from "@/app/api/tasks/route"
import type { TaskStatus, TaskType, TaskPriority } from "@/db/schema"
import TaskEditDialog from "@/components/forms/form-task-edit"
import { TaskCard } from "@/components/blocks/task-card"
import { TaskDetailDrawer } from "@/components/blocks/task-detail-drawer"
import { TaskTimeline } from "@/components/blocks/task-timeline"
import { GlobalSearch } from "@/components/blocks/global-search"
import { AiChatTrigger } from "@/components/blocks/global-ai-chat"

const PAGE_SIZE = 6

type TaskView = "cards" | "table"

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "closed"]

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Выполнено",
  closed: "Закрыто",
}

const TYPES: TaskType[] = [
  "meet",
  "call",
  "email",
  "offer",
  "docs",
  "support",
  "other",
]
const TYPE_LABELS: Record<TaskType, string> = {
  meet: "Встреча",
  call: "Звонок",
  email: "Email",
  offer: "Предложение",
  docs: "Документы",
  support: "Поддержка",
  other: "Другое",
}

const PRIORITIES: TaskPriority[] = ["low", "medium", "high"]
const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
}

const ALL = "__all__"
const NO_DEAL = "__none__" // «Без сделки» в фильтре (пустое value ломает Radix)

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
  onOpenDetail,
  emptyLabel,
}: {
  tasks: TaskRow[]
  onChanged: () => void
  onOpenDetail: (taskId: string) => void
  emptyLabel: string
}) {
  const paged = usePaged(tasks)

  const grid = useMemo(
    () =>
      paged.pageItems.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          onChanged={onChanged}
          onOpenDetail={onOpenDetail}
        />
      )),
    [paged.pageItems, onChanged, onOpenDetail],
  )

  if (tasks.length === 0) {
    return <EmptyState label={emptyLabel} />
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">{grid}</div>
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

// Табличный вид — тот же набор задач, что и StatusBucket выше (тот же
// набор пропсов), просто строками вместо карточек.
function TaskTable({
  tasks,
  onOpenDetail,
  emptyLabel,
}: {
  tasks: TaskRow[]
  onOpenDetail: (taskId: string) => void
  emptyLabel: string
}) {
  if (tasks.length === 0) {
    return <EmptyState label={emptyLabel} />
  }
  return (
    <Card className="py-0">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Приоритет</TableHead>
              <TableHead>Срок</TableHead>
              <TableHead>Исполнитель</TableHead>
              <TableHead>Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t) => (
              <TableRow
                key={t.id}
                className="cursor-pointer"
                onClick={() => onOpenDetail(t.id)}
              >
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{TYPE_LABELS[t.type]}</TableCell>
                <TableCell>{PRIORITY_LABELS[t.priority]}</TableCell>
                <TableCell>
                  {new Date(t.dueDate).toLocaleDateString("ru-RU")}
                </TableCell>
                <TableCell>{t.assigneeName ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{STATUS_LABELS[t.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <TasksPageContent />
    </Suspense>
  )
}

function TasksPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)

  const [members, setMembers] = useState<OrgMemberOption[]>([])
  const [clientOptions, setClientOptions] = useState<TaskClientOption[]>([])
  const [contactOptions, setContactOptions] = useState<TaskContactOption[]>([])
  const [dealOptions, setDealOptions] = useState<
    { id: string; name: string; clientName: string | null }[]
  >([])

  // Открытие конкретной задачи по ссылке (?openTask=<id>) — например, из
  // карточки задачи в дровере сделки. Диалог открывается сам, как только
  // задача появится в загруженном списке.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  useEffect(() => {
    const id = searchParams.get("openTask")
    if (id) setOpenTaskId(id)
  }, [searchParams])
  const openTask = useMemo(
    () => tasks.find((t) => t.id === openTaskId) ?? null,
    [tasks, openTaskId],
  )

  const [view, setView] = useState<TaskView>("cards")
  // Отличаем «реально пусто» от «запрос не выполнился» (сеть/БД) — иначе
  // сбой рендерится как «задач нет», что читается как потеря данных.
  const [loadError, setLoadError] = useState(false)

  const [statusFilter, setStatusFilter] = useState<string>(ALL)
  const [typeFilter, setTypeFilter] = useState<string>(ALL)
  const [priorityFilter, setPriorityFilter] = useState<string>(ALL)
  const [assigneeFilter, setAssigneeFilter] = useState<string>(ALL)
  const [clientFilter, setClientFilter] = useState<string>(ALL)
  const [contactFilter, setContactFilter] = useState<string>(ALL)
  const [dealFilter, setDealFilter] = useState<string>(ALL)

  const refreshAll = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks")
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const data = await res.json()
      setLoadError(false)
      setTasks(data.tasks ?? [])
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [tasksRes, mRes, cRes, ctRes, dRes] = await Promise.all([
          fetch("/api/tasks").then((r) => {
            if (!r.ok) throw new Error("Failed to load tasks")
            return r.json()
          }),
          fetch("/api/tasks?members=1").then((r) => r.json()),
          fetch("/api/tasks?clientOptions=1").then((r) => r.json()),
          fetch("/api/tasks?contactOptions=1").then((r) => r.json()),
          fetch("/api/deals").then((r) => r.json()),
        ])
        if (cancelled) return
        setLoadError(false)
        setTasks(tasksRes.tasks ?? [])
        setMembers(mRes.members ?? [])
        setClientOptions(cRes.options ?? [])
        setContactOptions(ctRes.options ?? [])
        type DealLite = {
          id: string
          name: string
          clientName: string | null
          status: string
        }
        setDealOptions(
          ((dRes.deals ?? []) as DealLite[])
            .filter((d) => d.status === "active")
            .map((d) => ({ id: d.id, name: d.name, clientName: d.clientName })),
        )
      } catch {
        if (!cancelled) setLoadError(true)
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
    return tasks.filter((t) => {
      if (statusFilter !== ALL && t.status !== statusFilter) return false
      if (typeFilter !== ALL && t.type !== typeFilter) return false
      if (priorityFilter !== ALL && t.priority !== priorityFilter) return false
      if (assigneeFilter !== ALL && t.assigneeId !== assigneeFilter)
        return false
      if (clientFilter !== ALL && (t.clientId ?? "") !== clientFilter)
        return false
      if (contactFilter !== ALL && (t.contactId ?? "") !== contactFilter)
        return false
      if (dealFilter !== ALL) {
        if (dealFilter === NO_DEAL) {
          if (t.dealId) return false // «Без сделки» — только непривязанные
        } else if (t.dealId !== dealFilter) return false
      }
      return true
    })
  }, [
    tasks,
    statusFilter,
    typeFilter,
    priorityFilter,
    assigneeFilter,
    clientFilter,
    contactFilter,
    dealFilter,
  ])

  const hasActiveFilters =
    statusFilter !== ALL ||
    typeFilter !== ALL ||
    priorityFilter !== ALL ||
    assigneeFilter !== ALL ||
    clientFilter !== ALL ||
    contactFilter !== ALL ||
    dealFilter !== ALL

  const clearFilters = () => {
    setStatusFilter(ALL)
    setTypeFilter(ALL)
    setPriorityFilter(ALL)
    setAssigneeFilter(ALL)
    setClientFilter(ALL)
    setContactFilter(ALL)
    setDealFilter(ALL)
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-10 min-h-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-medium">Задачи</h1>
        <div className="flex items-center gap-2">
          <AiChatTrigger />
          <GlobalSearch />
        </div>
      </div>

      {/* Канбан без внешнего Card-контейнера — заголовок страницы достаточен. */}
      <div className="w-full">

          {/* «Новая задача» — слева; фильтры (включая статус) в один ряд —
              оптимизирует место по вертикали, тот же паттерн, что на
              Компаниях/Контактах. Селекты в grid (адаптивно сжимаются на
              узком), переключатель вида прижат вправо. */}
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
            <TaskEditDialog
              mode="create"
              onSuccess={refreshAll}
              trigger={
                <Button size="sm" className="shrink-0">
                  <Plus className="h-4 w-4 mr-1" />
                  Новая задача
                </Button>
              }
            />
            <div className="grid flex-1 min-w-0 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все статусы</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger size="sm" className="w-full">
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
              <SelectTrigger size="sm" className="w-full">
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
              <SelectTrigger size="sm" className="w-full">
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
              <SelectTrigger size="sm" className="w-full">
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
              <SelectTrigger size="sm" className="w-full">
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
            {/* Фильтр по сделке: «Все сделки» (по умолчанию) / «Без сделки» /
                конкретная сделка (task.dealId). */}
            <Select value={dealFilter} onValueChange={setDealFilter}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Сделка" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все сделки</SelectItem>
                <SelectItem value={NO_DEAL}>Без сделки</SelectItem>
                {dealOptions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.clientName ? `${d.clientName} — ${d.name}` : d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
            <Tabs value={view} onValueChange={(v) => setView(v as TaskView)}>
              <TabsList>
                <TabsTrigger value="cards" aria-label="Вид карточками" title="в виде карточек">
                  <PlayingCardsFan className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="table" aria-label="Вид таблицей" title="списком">
                  <Rows4 className="h-4 w-4" />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* min-h-8 = высота кнопки сброса: строка не прыгает, когда кнопка
              появляется/исчезает вместе с активными фильтрами. */}
          <div className="mb-3 flex min-h-8 items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {filteredTasks.length} из {tasks.length} задач
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Сбросить фильтры
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="animate-spin h-6 w-6" />
            </div>
          ) : loadError && tasks.length === 0 ? (
            <Card className="border-dashed border-destructive/40 bg-destructive/5">
              <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <span className="text-sm text-muted-foreground">
                  Не удалось загрузить задачи. Проверьте соединение и попробуйте ещё раз.
                </span>
                <Button size="sm" variant="outline" onClick={() => void refreshAll()}>
                  Повторить
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {view === "cards" ? (
                <StatusBucket
                  tasks={filteredTasks}
                  onChanged={refreshAll}
                  onOpenDetail={setOpenTaskId}
                  emptyLabel={
                    hasActiveFilters
                      ? "Нет задач по фильтрам."
                      : "Задач пока нет."
                  }
                />
              ) : (
                <TaskTable
                  tasks={filteredTasks}
                  onOpenDetail={setOpenTaskId}
                  emptyLabel={
                    hasActiveFilters
                      ? "Нет задач по фильтрам."
                      : "Задач пока нет."
                  }
                />
              )}
            </>
          )}
      </div>

      <Card className="w-full">
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

      <TaskDetailDrawer
        task={openTask}
        open={Boolean(openTask)}
        onOpenChange={(o) => {
          if (!o) {
            setOpenTaskId(null)
            router.replace("/tasks")
          }
        }}
        onChanged={refreshAll}
      />
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
