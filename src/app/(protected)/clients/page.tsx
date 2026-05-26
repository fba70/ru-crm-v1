"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
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
import { Loader, Plus, Sparkles, X } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import type { ClientRow } from "@/app/api/clients/route"
import type { ContactRow } from "@/app/api/contacts/route"
import type {
  DealRow,
  DealClientOption,
  DealFunnelStageOption,
} from "@/app/api/deals/route"
import ClientEditDialog from "@/components/forms/form-client-edit"
import ContactEditDialog from "@/components/forms/form-contact-edit"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { ClientCard } from "@/components/blocks/client-card"
import { ContactCard } from "@/components/blocks/contact-card"
import { DealCard } from "@/components/blocks/deal-card"
import { DiscoverDialog } from "@/components/blocks/discover-dialog"
import { DiscoverDealsDialog } from "@/components/blocks/discover-deals-dialog"

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
  const [deals, setDeals] = useState<DealRow[]>([])
  const [dealStages, setDealStages] = useState<DealFunnelStageOption[]>([])
  const [dealClientOptions, setDealClientOptions] = useState<
    DealClientOption[]
  >([])
  const [loading, setLoading] = useState(true)

  const [clientNameFilter, setClientNameFilter] = useState("")
  const [clientEmailFilter, setClientEmailFilter] = useState("")
  const [clientStatusFilter, setClientStatusFilter] = useState<string>(ALL)
  const [clientPhaseFilter, setClientPhaseFilter] = useState<string>(ALL)
  const [contactNameFilter, setContactNameFilter] = useState("")
  const [contactEmailFilter, setContactEmailFilter] = useState("")
  const [contactStatusFilter, setContactStatusFilter] = useState<string>(ALL)

  // Deals filters: text spans name+description, client narrows by id.
  // includeCancelled / includeDeleted default off so both soft-deleted sets
  // stay out of view (server returns them; these are client-side toggles).
  const [dealQueryFilter, setDealQueryFilter] = useState("")
  const [dealClientFilter, setDealClientFilter] = useState<string>(ALL)
  const [dealIncludeCancelled, setDealIncludeCancelled] = useState(false)
  const [dealIncludeDeleted, setDealIncludeDeleted] = useState(false)

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

  const loadDeals = useCallback(async () => {
    // Always pull cancelled + deleted from the server; the include-cancelled
    // / include-deleted checkboxes are client-side filters, so toggling them
    // doesn't refetch.
    const res = await fetch("/api/deals?includeCancelled=1&includeDeleted=1")
    const data = await res.json()
    setDeals(data.deals ?? [])
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadClients(), loadContacts(), loadDeals()])
  }, [loadClients, loadContacts, loadDeals])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        await refreshAll()
        const [stagesRes, dealClientsRes] = await Promise.all([
          fetch("/api/deals?funnelStages=1").then((r) => r.json()),
          fetch("/api/deals?clientOptions=1").then((r) => r.json()),
        ])
        if (cancelled) return
        setDealStages(stagesRes.stages ?? [])
        setDealClientOptions(dealClientsRes.options ?? [])
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

  const filteredDeals = useMemo(() => {
    const q = dealQueryFilter.trim().toLowerCase()
    return deals.filter((d) => {
      if (!dealIncludeCancelled && d.status === "cancelled") return false
      if (!dealIncludeDeleted && d.status === "deleted") return false
      if (dealClientFilter !== ALL && d.clientId !== dealClientFilter) {
        return false
      }
      if (q) {
        const inName = d.name.toLowerCase().includes(q)
        const inDescription = (d.description ?? "").toLowerCase().includes(q)
        if (!inName && !inDescription) return false
      }
      return true
    })
  }, [
    deals,
    dealQueryFilter,
    dealClientFilter,
    dealIncludeCancelled,
    dealIncludeDeleted,
  ])

  const dealsByStage = useMemo(() => {
    const map = new Map<string, DealRow[]>()
    for (const s of dealStages) map.set(s.id, [])
    for (const d of filteredDeals) {
      const bucket = map.get(d.funnelStageId)
      if (bucket) bucket.push(d)
      // Deals on stages outside the resolved stage list (e.g. a stale
      // org-scoped reference after the funnel was changed) are intentionally
      // dropped — there's no kanban tab to render them in.
    }
    return map
  }, [dealStages, filteredDeals])

  // Sales funnel value: sum of (deal.value × stage.closureProbability)
  // across ALL non-cancelled deals — board-level summary, deliberately
  // ignores the kanban filters so the headline number stays stable as
  // the operator drills around. Per-deal probability comes from the
  // joined `funnelStageProbability` on the row, so deals whose stage is
  // outside the currently-resolved stage list still contribute correctly.
  const salesFunnelValue = useMemo(() => {
    let total = 0
    for (const d of deals) {
      // Only active deals count toward the funnel value — cancelled and
      // deleted are soft-deleted.
      if (d.status !== "active") continue
      if (d.value === null) continue
      const v = Number(d.value)
      if (!Number.isFinite(v)) continue
      total += v * d.funnelStageProbability
    }
    return total
  }, [deals])

  const clientPaged = usePaged(filteredClients, CLIENT_CONTACT_PAGE_SIZE)
  const contactPaged = usePaged(filteredContacts, CLIENT_CONTACT_PAGE_SIZE)

  const clientGrid = useMemo(
    () =>
      clientPaged.pageItems.map((c) => (
        <ClientCard key={c.id} client={c} onChanged={refreshAll} />
      )),
    [clientPaged.pageItems, refreshAll],
  )

  const contactGrid = useMemo(
    () =>
      contactPaged.pageItems.map((c) => (
        <ContactCard key={c.id} contact={c} onChanged={refreshAll} />
      )),
    [contactPaged.pageItems, refreshAll],
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

  const hasDealFilters =
    dealQueryFilter.trim() !== "" ||
    dealClientFilter !== ALL ||
    dealIncludeCancelled ||
    dealIncludeDeleted

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
  const clearDealFilters = () => {
    setDealQueryFilter("")
    setDealClientFilter(ALL)
    setDealIncludeCancelled(false)
    setDealIncludeDeleted(false)
  }

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">CLIENTS</h1>

      <div className="w-full max-w-7xl px-4">
        <Tabs defaultValue="clientsContacts" className="w-full">
          <TabsList>
            <TabsTrigger value="clientsContacts">
              Clients &amp; Contacts
            </TabsTrigger>
            <TabsTrigger value="deals">Deals</TabsTrigger>
          </TabsList>

          <TabsContent
            value="clientsContacts"
            forceMount
            className="mt-4 data-[state=inactive]:hidden space-y-4"
          >
            {/* Shared toolbar for both sections */}
            <div className="flex justify-end gap-2 flex-wrap">
              <DiscoverDialog
                onApplied={refreshAll}
                trigger={
                  <Button size="sm" variant="default">
                    <Sparkles className="h-4 w-4 mr-1" />
                    Discover from sources
                  </Button>
                }
              />
              <ClientEditDialog
                mode="create"
                onSuccess={refreshAll}
                trigger={
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    New client
                  </Button>
                }
              />
              <ContactEditDialog
                mode="create"
                onSuccess={refreshAll}
                trigger={
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    New contact
                  </Button>
                }
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Clients</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Filter by name…"
                    value={clientNameFilter}
                    onChange={(e) => setClientNameFilter(e.target.value)}
                    className="flex-1 min-w-45"
                  />
                  <Input
                    placeholder="Filter by email…"
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
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      {CLIENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={clientPhaseFilter}
                    onValueChange={setClientPhaseFilter}
                  >
                    <SelectTrigger className="w-fit">
                      <SelectValue placeholder="Funnel phase" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All funnel phases</SelectItem>
                      {FUNNEL_PHASES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    {filteredClients.length} of {clients.length} clients
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearClientFilters}
                    disabled={!hasClientFilters}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Clear filters
                  </Button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader className="animate-spin h-6 w-6" />
                  </div>
                ) : clients.length === 0 ? (
                  <EmptyState label="No clients yet." />
                ) : filteredClients.length === 0 ? (
                  <EmptyState label="No clients match the filters." />
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
                <CardTitle>Contacts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Filter by name…"
                    value={contactNameFilter}
                    onChange={(e) => setContactNameFilter(e.target.value)}
                    className="flex-1 min-w-45"
                  />
                  <Input
                    placeholder="Filter by email…"
                    value={contactEmailFilter}
                    onChange={(e) => setContactEmailFilter(e.target.value)}
                    className="flex-1 min-w-45"
                  />
                  <Select
                    value={contactStatusFilter}
                    onValueChange={setContactStatusFilter}
                  >
                    <SelectTrigger className="w-fit">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      {CLIENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    {filteredContacts.length} of {contacts.length} contacts
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearContactFilters}
                    disabled={!hasContactFilters}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Clear filters
                  </Button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader className="animate-spin h-6 w-6" />
                  </div>
                ) : contacts.length === 0 ? (
                  <EmptyState label="No contacts yet." />
                ) : filteredContacts.length === 0 ? (
                  <EmptyState label="No contacts match the filters." />
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
          </TabsContent>

          <TabsContent
            value="deals"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm text-muted-foreground">
                      Curent sales funnel value:
                    </span>
                    <span className="text-xl font-semibold text-orange-300">
                      €
                      {salesFunnelValue.toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <DiscoverDealsDialog
                      onDealsGenerated={refreshAll}
                      trigger={
                        <Button size="sm" variant="default">
                          <Sparkles className="h-4 w-4 mr-1" />
                          Discover from sources
                        </Button>
                      }
                    />
                    <DealEditDialog
                      mode="create"
                      onSuccess={refreshAll}
                      trigger={
                        <Button size="sm">
                          <Plus className="h-4 w-4 mr-1" />
                          New deal
                        </Button>
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Search name or description…"
                    value={dealQueryFilter}
                    onChange={(e) => setDealQueryFilter(e.target.value)}
                    className="flex-1 min-w-45"
                  />
                  <Select
                    value={dealClientFilter}
                    onValueChange={setDealClientFilter}
                  >
                    <SelectTrigger className="w-fit">
                      <SelectValue placeholder="Client" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All clients</SelectItem>
                      {dealClientOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <Checkbox
                      checked={dealIncludeCancelled}
                      onCheckedChange={(v) =>
                        setDealIncludeCancelled(Boolean(v))
                      }
                    />
                    Include cancelled
                  </label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <Checkbox
                      checked={dealIncludeDeleted}
                      onCheckedChange={(v) => setDealIncludeDeleted(Boolean(v))}
                    />
                    Include deleted
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    {filteredDeals.length} of {deals.length} deals
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearDealFilters}
                    disabled={!hasDealFilters}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Clear filters
                  </Button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader className="animate-spin h-6 w-6" />
                  </div>
                ) : dealStages.length === 0 ? (
                  <EmptyState label="No funnel stages configured. Run the seed script to populate them." />
                ) : (
                  <Tabs defaultValue={dealStages[0].id} className="w-full">
                    <TabsList className="flex-wrap h-auto">
                      {dealStages.map((s) => (
                        <TabsTrigger key={s.id} value={s.id}>
                          {s.name}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            ({(dealsByStage.get(s.id) ?? []).length})
                          </span>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {dealStages.map((s) => {
                      const bucket = dealsByStage.get(s.id) ?? []
                      return (
                        <TabsContent key={s.id} value={s.id} className="mt-4">
                          <DealStageBucket
                            deals={bucket}
                            stages={dealStages}
                            onChanged={refreshAll}
                            emptyLabel={
                              hasDealFilters
                                ? `No deals match the filters in "${s.name}".`
                                : `No deals in "${s.name}".`
                            }
                          />
                        </TabsContent>
                      )
                    })}
                  </Tabs>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function DealStageBucket({
  deals,
  stages,
  onChanged,
  emptyLabel,
}: {
  deals: DealRow[]
  stages: DealFunnelStageOption[]
  onChanged: () => void
  emptyLabel: string
}) {
  const paged = usePaged(deals)

  if (deals.length === 0) {
    return <EmptyState label={emptyLabel} />
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {paged.pageItems.map((d) => (
          <DealCard key={d.id} deal={d} stages={stages} onChanged={onChanged} />
        ))}
      </div>
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
