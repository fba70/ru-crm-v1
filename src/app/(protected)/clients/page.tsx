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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Ban, Loader, Plus, Sparkles, X } from "lucide-react"
import type { ClientRow } from "@/app/api/clients/route"
import type { ContactRow } from "@/app/api/contacts/route"
import ClientEditDialog from "@/components/forms/form-client-edit"
import ContactEditDialog from "@/components/forms/form-contact-edit"
import { ClientCard } from "@/components/blocks/client-card"
import { ContactCard } from "@/components/blocks/contact-card"
import { DiscoverDialog } from "@/components/blocks/discover-dialog"
import { MagicDiscoverButton } from "@/components/blocks/magic-discover-button"
import { ClientEnrichControl } from "@/components/blocks/client-enrich-control"
import { ClientBlocklistDialog } from "@/components/blocks/client-blocklist-dialog"

const PAGE_SIZE = 6
// Clients + Contacts share one merged tab with two stacked grids; 3 cards
// per row, one row visible each, so both sections fit on one screen.
const CLIENT_CONTACT_PAGE_SIZE = 3
const ALL = "__all__"

// `deleted` is a soft-delete (test/garbage records, excluded from discovery).
// It's selectable here so operators can view/restore them, but hidden under
// the default "All statuses" view (see filteredClients / filteredContacts).
const CLIENT_STATUSES = ["active", "initial", "suspended", "deleted"] as const
const FUNNEL_PHASES = [
  "awareness",
  "interest",
  "decision",
  "action",
  "retention",
] as const

// UI display labels (DB enum values stay English).
const STATUS_LABEL: Record<string, string> = {
  active: "Активный",
  initial: "Новый",
  suspended: "Приостановлен",
  deleted: "Удалён",
}
const PHASE_LABEL: Record<string, string> = {
  awareness: "Осведомлённость",
  interest: "Интерес",
  decision: "Решение",
  action: "Действие",
  retention: "Удержание",
}

function usePaged<T>(items: T[], pageSize: number = PAGE_SIZE) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const effectivePage = Math.min(page, totalPages)
  const start = (effectivePage - 1) * pageSize
  const pageItems = items.slice(start, start + pageSize)
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

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [loading, setLoading] = useState(true)
  // Owner-only: drives the blocklist management button + per-entity/candidate
  // Block actions. Best-effort gate (the server is the real one).
  const [canBlock, setCanBlock] = useState(false)

  const [clientNameFilter, setClientNameFilter] = useState("")
  const [clientEmailFilter, setClientEmailFilter] = useState("")
  const [clientStatusFilter, setClientStatusFilter] = useState<string>(ALL)
  const [clientPhaseFilter, setClientPhaseFilter] = useState<string>(ALL)
  const [contactNameFilter, setContactNameFilter] = useState("")
  const [contactEmailFilter, setContactEmailFilter] = useState("")
  const [contactStatusFilter, setContactStatusFilter] = useState<string>(ALL)

  const loadClients = useCallback(async () => {
    const res = await fetch("/api/clients")
    const data = await res.json()
    setClients(data.clients ?? [])
  }, [])

  const loadContacts = useCallback(async () => {
    const res = await fetch("/api/contacts")
    const data = await res.json()
    setContacts(data.contacts ?? [])
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadClients(), loadContacts()])
  }, [loadClients, loadContacts])

  // Resolve whether the current user can manage the blocklist (org owner).
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

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        await refreshAll()
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [refreshAll])

  const filteredClients = useMemo(() => {
    const name = clientNameFilter.trim().toLowerCase()
    const email = clientEmailFilter.trim().toLowerCase()
    return clients.filter((c) => {
      // "All statuses" shows active / initial / suspended but hides soft-
      // deleted rows; pick "deleted" explicitly to view/restore them.
      if (clientStatusFilter === ALL) {
        if (c.status === "deleted") return false
      } else if (c.status !== clientStatusFilter) {
        return false
      }
      if (clientPhaseFilter !== ALL && c.funnelPhase !== clientPhaseFilter) {
        return false
      }
      if (name && !c.name.toLowerCase().includes(name)) return false
      if (email && !(c.email ?? "").toLowerCase().includes(email)) return false
      return true
    })
  }, [
    clients,
    clientNameFilter,
    clientEmailFilter,
    clientStatusFilter,
    clientPhaseFilter,
  ])

  const filteredContacts = useMemo(() => {
    const name = contactNameFilter.trim().toLowerCase()
    const email = contactEmailFilter.trim().toLowerCase()
    return contacts.filter((c) => {
      // Same rule as clients: hide soft-deleted under "All statuses".
      if (contactStatusFilter === ALL) {
        if (c.status === "deleted") return false
      } else if (c.status !== contactStatusFilter) {
        return false
      }
      // Name filter matches the technical name OR the native-language name,
      // so searching either spelling finds the contact.
      if (
        name &&
        !c.name.toLowerCase().includes(name) &&
        !(c.nameNative ?? "").toLowerCase().includes(name)
      ) {
        return false
      }
      if (email && !(c.email ?? "").toLowerCase().includes(email)) return false
      return true
    })
  }, [contacts, contactNameFilter, contactEmailFilter, contactStatusFilter])

  const clientPaged = usePaged(filteredClients, CLIENT_CONTACT_PAGE_SIZE)
  const contactPaged = usePaged(filteredContacts, CLIENT_CONTACT_PAGE_SIZE)

  const clientGrid = useMemo(
    () =>
      clientPaged.pageItems.map((c) => (
        <ClientCard
          key={c.id}
          client={c}
          onChanged={refreshAll}
          canBlock={canBlock}
        />
      )),
    [clientPaged.pageItems, refreshAll, canBlock],
  )

  const contactGrid = useMemo(
    () =>
      contactPaged.pageItems.map((c) => (
        <ContactCard
          key={c.id}
          contact={c}
          onChanged={refreshAll}
          canBlock={canBlock}
        />
      )),
    [contactPaged.pageItems, refreshAll, canBlock],
  )

  const hasClientFilters =
    clientNameFilter.trim() !== "" ||
    clientEmailFilter.trim() !== "" ||
    clientStatusFilter !== ALL ||
    clientPhaseFilter !== ALL
  const hasContactFilters =
    contactNameFilter.trim() !== "" ||
    contactEmailFilter.trim() !== "" ||
    contactStatusFilter !== ALL

  const clearClientFilters = () => {
    setClientNameFilter("")
    setClientEmailFilter("")
    setClientStatusFilter(ALL)
    setClientPhaseFilter(ALL)
  }
  const clearContactFilters = () => {
    setContactNameFilter("")
    setContactEmailFilter("")
    setContactStatusFilter(ALL)
  }

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">КЛИЕНТЫ & КОНТАКТЫ</h1>

      <div className="w-full max-w-7xl px-4 space-y-4">
        {/* Shared toolbar for both sections */}
        <div className="flex justify-end gap-2 flex-wrap">
          <MagicDiscoverButton onApplied={refreshAll} />
          <DiscoverDialog
            onApplied={refreshAll}
            canBlock={canBlock}
            trigger={
              <Button size="sm" variant="default">
                <Sparkles className="h-4 w-4 mr-1" />
                Найти в источниках
              </Button>
            }
          />
          <ClientEnrichControl refreshKey={clients.length} onChanged={refreshAll} />
          <ClientEditDialog
            mode="create"
            onSuccess={refreshAll}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Новый клиент
              </Button>
            }
          />
          <ContactEditDialog
            mode="create"
            onSuccess={refreshAll}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Новый контакт
              </Button>
            }
          />
          {canBlock && (
            <ClientBlocklistDialog
              onChanged={refreshAll}
              trigger={
                <Button size="sm" variant="outline">
                  <Ban className="h-4 w-4 mr-1" />
                  Список блокировки
                </Button>
              }
            />
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Клиенты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Фильтр по названию…"
                value={clientNameFilter}
                onChange={(e) => setClientNameFilter(e.target.value)}
                className="flex-1 min-w-45"
              />
              <Input
                placeholder="Фильтр по email…"
                value={clientEmailFilter}
                onChange={(e) => setClientEmailFilter(e.target.value)}
                className="flex-1 min-w-45"
              />
              <Select
                value={clientStatusFilter}
                onValueChange={setClientStatusFilter}
              >
                {/* w-fit lets the trigger size to the longest label
                    ("All statuses") so the dropdowns stay compact and
                    the inputs absorb the remaining row width. */}
                <SelectTrigger className="w-fit">
                  <SelectValue placeholder="Статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Все статусы</SelectItem>
                  {CLIENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s] ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={clientPhaseFilter}
                onValueChange={setClientPhaseFilter}
              >
                <SelectTrigger className="w-fit">
                  <SelectValue placeholder="Этап воронки" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Все этапы воронки</SelectItem>
                  {FUNNEL_PHASES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PHASE_LABEL[p] ?? p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-muted-foreground">
                {filteredClients.length} из {clients.length} клиентов
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearClientFilters}
                disabled={!hasClientFilters}
              >
                <X className="h-4 w-4 mr-1" />
                Сбросить фильтры
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="animate-spin h-6 w-6" />
              </div>
            ) : clients.length === 0 ? (
              <EmptyState label="Пока нет клиентов." />
            ) : filteredClients.length === 0 ? (
              <EmptyState label="Нет клиентов по заданным фильтрам." />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">{clientGrid}</div>
                <div className="flex justify-center">
                  <PagerNav
                    page={clientPaged.page}
                    totalPages={clientPaged.totalPages}
                    setPage={clientPaged.setPage}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Контакты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Фильтр по имени…"
                value={contactNameFilter}
                onChange={(e) => setContactNameFilter(e.target.value)}
                className="flex-1 min-w-45"
              />
              <Input
                placeholder="Фильтр по email…"
                value={contactEmailFilter}
                onChange={(e) => setContactEmailFilter(e.target.value)}
                className="flex-1 min-w-45"
              />
              <Select
                value={contactStatusFilter}
                onValueChange={setContactStatusFilter}
              >
                <SelectTrigger className="w-fit">
                  <SelectValue placeholder="Статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Все статусы</SelectItem>
                  {CLIENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s] ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-muted-foreground">
                {filteredContacts.length} из {contacts.length} контактов
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearContactFilters}
                disabled={!hasContactFilters}
              >
                <X className="h-4 w-4 mr-1" />
                Сбросить фильтры
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="animate-spin h-6 w-6" />
              </div>
            ) : contacts.length === 0 ? (
              <EmptyState label="Пока нет контактов." />
            ) : filteredContacts.length === 0 ? (
              <EmptyState label="Нет контактов по заданным фильтрам." />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">{contactGrid}</div>
                <div className="flex justify-center">
                  <PagerNav
                    page={contactPaged.page}
                    totalPages={contactPaged.totalPages}
                    setPage={contactPaged.setPage}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
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
