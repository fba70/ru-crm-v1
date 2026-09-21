"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { AlertTriangle, Loader, Plus, Rows4, PlayingCardsFan } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ContactRow, ClientOption } from "@/app/api/contacts/route"
import ContactEditDialog from "@/components/forms/form-contact-edit"
import { ContactDetailDrawer } from "@/components/blocks/contact-detail-drawer"
import { ContactCard } from "@/components/blocks/contact-card"
import { GlobalSearch } from "@/components/blocks/global-search"
import { AiChatTrigger } from "@/components/blocks/global-ai-chat"

type ContactView = "cards" | "table"

const ALL = "__all__"
const NO_CLIENT = "__none__"
const PAGE_SIZE = 25

const STATUSES = ["active", "initial", "suspended", "deleted", "blocked"] as const
const STATUS_LABEL: Record<string, string> = {
  active: "Активный",
  initial: "Новый",
  suspended: "Приостановлен",
  deleted: "Удалён",
  blocked: "Заблокирован",
}

export default function ContactsPage() {
  const [rows, setRows] = useState<ContactRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>(ALL)
  const [clientFilter, setClientFilter] = useState<string>(ALL)
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null)
  const [view, setView] = useState<ContactView>("table")
  const [canBlock, setCanBlock] = useState(false)
  // Отличаем «реально пусто» от «запрос не выполнился» (сеть/БД) — иначе
  // сбой рендерится как «контактов нет», что читается как потеря данных.
  const [loadError, setLoadError] = useState(false)

  const reqIdRef = useRef(0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const load = useCallback(async () => {
    setLoading(true)
    const reqId = ++reqIdRef.current
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      })
      if (statusFilter !== ALL) params.set("status", statusFilter)
      if (clientFilter !== ALL) params.set("clientId", clientFilter)
      const res = await fetch(`/api/contacts?${params.toString()}`)
      if (reqIdRef.current !== reqId) return
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const data = await res.json()
      if (reqIdRef.current !== reqId) return
      setLoadError(false)
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch {
      if (reqIdRef.current === reqId) setLoadError(true)
    } finally {
      if (reqIdRef.current === reqId) setLoading(false)
    }
  }, [page, statusFilter, clientFilter])

  useEffect(() => {
    void load()
  }, [load])

  // Filter changes reset to page 1.
  useEffect(() => {
    setPage(1)
  }, [statusFilter, clientFilter])

  useEffect(() => {
    fetch("/api/contacts?clientOptions=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setClientOptions(d.options ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/blocklist")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setCanBlock(Boolean(d.canManage))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Deep-link from the global search (/contacts?openContact=<id>).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const contactId = params.get("openContact")
    if (!contactId) return
    window.history.replaceState(null, "", window.location.pathname)
    void (async () => {
      const res = await fetch(`/api/contacts?id=${encodeURIComponent(contactId)}`)
      if (!res.ok) return
      const data = await res.json()
      if (data.contact) setEditingContact(data.contact)
    })()
  }, [])

  return (
    <div className="flex flex-col h-[calc(100vh-1rem)] p-4 gap-4">
      <div className="flex items-center justify-between gap-4 shrink-0">
        <h1 className="text-xl font-medium">Контакты</h1>
        <div className="flex items-center gap-2">
          <AiChatTrigger />
          <GlobalSearch />
        </div>
      </div>

      {/* «Новый контакт» — слева; селекты статуса/компании следом;
          переключатель вида — прижат вправо. Белый контейнер — как на
          Компаниях/Сделках/Домашней. */}
      <div className="flex items-center gap-2 flex-wrap shrink-0 rounded-xl border bg-card p-3">
        <ContactEditDialog
          mode="create"
          onSuccess={load}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Новый контакт
            </Button>
          }
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger size="sm" className="w-fit">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все статусы</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger size="sm" className="w-fit">
            <SelectValue placeholder="Компания" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все компании</SelectItem>
            <SelectItem value={NO_CLIENT}>Без компании</SelectItem>
            {clientOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Tabs value={view} onValueChange={(v) => setView(v as ContactView)}>
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
      </div>

      <div className="text-xs text-muted-foreground shrink-0">
        {rows.length} из {total} контактов
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="animate-spin h-6 w-6" />
          </div>
        ) : loadError && rows.length === 0 ? (
          <Card className="border-dashed border-destructive/40 bg-destructive/5">
            <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <span className="text-sm text-muted-foreground">
                Не удалось загрузить контакты. Проверьте соединение и попробуйте ещё раз.
              </span>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                Повторить
              </Button>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Контакты не найдены.
            </CardContent>
          </Card>
        ) : view === "cards" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {rows.map((c) => (
              <ContactCard
                key={c.id}
                contact={c}
                onOpenDetail={() => setEditingContact(c)}
              />
            ))}
          </div>
        ) : (
          <Card className="py-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Имя</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Телефон</TableHead>
                    <TableHead>Компания</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => setEditingContact(c)}
                    >
                      <TableCell>
                        <div className="font-medium">{c.name}</div>
                        {c.nameNative && (
                          <div className="text-xs text-muted-foreground">
                            {c.nameNative}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{c.email ?? "—"}</TableCell>
                      <TableCell>{c.phone ?? "—"}</TableCell>
                      <TableCell>{c.clientName ?? "Без компании"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {STATUS_LABEL[c.status] ?? c.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {totalPages > 1 && (
        <Pagination className="shrink-0">
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
      )}

      <ContactDetailDrawer
        contact={editingContact}
        open={Boolean(editingContact)}
        onOpenChange={(open) => {
          if (!open) setEditingContact(null)
        }}
        onChanged={load}
        canBlock={canBlock}
      />
    </div>
  )
}
