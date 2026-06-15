"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ProductDetailDialog } from "@/components/blocks/product-detail-dialog"
import { OrdersTable } from "@/components/blocks/orders-table"
import {
  useOrderBuilder,
  OrderBuilderPanel,
  AddToOrderButton,
} from "@/components/blocks/order-builder"
import {
  NewOrderDialog,
  OrderRequestWizardStrip,
} from "@/components/blocks/order-request-wizard"
import { toast } from "sonner"
import { ExternalLink, Eye, ImageOff, Loader, Plus, X } from "lucide-react"
import type {
  ProductRow,
  ListProductsResult,
  ProductFilterOptions,
} from "@/app/api/products/route"
import type { OrderRequestItemView } from "@/app/api/order-requests/route"
import { parseQtyHint } from "@/lib/order-request"

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
const DEFAULT_PAGE_SIZE = 10
// Sentinel for the "All" option on every Select (shadcn SelectItem can't
// take an empty-string value).
const ALL = "__all__"

// Committed filter state — every field maps to a server query param. Select
// fields carry ALL when unset; text fields carry "". All filtering runs in
// SQL over the whole catalog (see /api/products), never on the fetched page.
type Filters = {
  q: string
  category: string
  type: string
  color: string
  sugar: string
  year: string
  aging: string
  bottleVolume: string
  countryName: string
  appelacion: string
  rating: string
  awards: string
  priceMin: string
  priceMax: string
  inStock: string // ALL | "in" | "out"
}

const EMPTY_FILTERS: Filters = {
  q: "",
  category: ALL,
  type: ALL,
  color: ALL,
  sugar: ALL,
  year: ALL,
  aging: ALL,
  bottleVolume: ALL,
  countryName: ALL,
  appelacion: ALL,
  rating: ALL,
  awards: "",
  priceMin: "",
  priceMax: "",
  inStock: ALL,
}

const EMPTY_OPTIONS: ProductFilterOptions = {
  type: [],
  color: [],
  sugar: [],
  year: [],
  aging: [],
  bottleVolume: [],
  countryName: [],
  appelacion: [],
  rating: [],
}

// A labelled filter cell: tiny caption above the control.
function FilterField({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

// A single-value attribute dropdown with an "All" reset option.
function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Все" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Все</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Format a price as RUB currency in the RU locale (thin-space grouping +
// ₽ symbol). Whole-ruble prices drop the fractional part; prices with
// kopecks keep up to 2 digits. Null prices render as a dash.
function formatPrice(price: number | null): string {
  if (price === null) return "—"
  return price.toLocaleString("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export default function ProductsPage() {
  const [rows, setRows] = useState<ProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)

  // `filters` is the COMMITTED state that drives the server fetch. Selects
  // commit immediately; the three free-text fields (search, price min/max,
  // awards) commit via the debounce below so typing doesn't fire a request
  // per keystroke.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [searchInput, setSearchInput] = useState("")
  const [priceMinInput, setPriceMinInput] = useState("")
  const [priceMaxInput, setPriceMaxInput] = useState("")
  const [awardsInput, setAwardsInput] = useState("")
  // Search V2: non-drink merch (glasses / water / syrups / gift-wrap) is hidden
  // from the catalog by default; this opts back in. Resets to page 1 on toggle.
  const [includeMerch, setIncludeMerch] = useState(false)

  const [categories, setCategories] = useState<string[]>([])
  const [options, setOptions] = useState<ProductFilterOptions>(EMPTY_OPTIONS)

  // Commit a Select/stock filter immediately + reset to page 1.
  const setSelect = useCallback((key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }, [])

  // Debounce the free-text inputs → committed filters. Resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({
        ...f,
        q: searchInput.trim(),
        priceMin: priceMinInput.trim(),
        priceMax: priceMaxInput.trim(),
        awards: awardsInput.trim(),
      }))
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, priceMinInput, priceMaxInput, awardsInput])

  // Distinct categories + attribute options for the filter dropdowns —
  // fetched once on mount.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch("/api/products?categories=1").then((r) => r.json()),
      fetch("/api/products?filterOptions=1").then((r) => r.json()),
    ])
      .then(([cats, opts]) => {
        if (cancelled) return
        setCategories(cats.categories ?? [])
        setOptions(opts.options ?? EMPTY_OPTIONS)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const clearAll = useCallback(() => {
    setSearchInput("")
    setPriceMinInput("")
    setPriceMaxInput("")
    setAwardsInput("")
    setIncludeMerch(false)
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }, [])

  // Any non-default filter active? Drives the Clear button + empty-state copy.
  const filtersActive =
    searchInput !== "" ||
    priceMinInput !== "" ||
    priceMaxInput !== "" ||
    awardsInput !== "" ||
    filters.category !== ALL ||
    filters.type !== ALL ||
    filters.color !== ALL ||
    filters.sugar !== ALL ||
    filters.year !== ALL ||
    filters.aging !== ALL ||
    filters.bottleVolume !== ALL ||
    filters.countryName !== ALL ||
    filters.appelacion !== ALL ||
    filters.rating !== ALL ||
    filters.inStock !== ALL ||
    includeMerch

  // Controlled tab + order-builder session. The builder lives at the page
  // level so it survives tab switches and the catalog table can feed
  // products into it. Saving bumps the orders list + jumps to the Orders tab.
  const [tab, setTab] = useState("catalog")
  const [ordersRefresh, setOrdersRefresh] = useState(0)
  const builder = useOrderBuilder({
    onSaved: () => {
      setOrdersRefresh((k) => k + 1)
      setTab("orders")
    },
  })
  // The catalog's "Add to order" column only appears while building an
  // editable order.
  const showAddCol = builder.isActive && !builder.readOnly
  const catalogColSpan = showAddCol ? 8 : 7

  // Manual branch of the unified New-order dialog: open the builder with the
  // chosen client + description preset (no request text → no LLM, no wizard).
  const startManualOrder = (opts: {
    clientId: string | null
    description: string
  }) => {
    builder.openNew()
    if (opts.clientId) builder.setClientId(opts.clientId)
    if (opts.description) builder.setDescription(opts.description)
    setTab("catalog")
  }
  const editOrder = (id: string) => {
    builder.openEdit(id)
    setTab("catalog")
  }

  // ── Order-from-request assistant ───────────────────────────────────
  // The paste dialog creates + parses a request; `startAssembly` then mints an
  // empty draft order (linked to the request) and walks the parsed intent
  // items one at a time, pre-filtering the catalog below for each step.
  const [requestDialogOpen, setRequestDialogOpen] = useState(false)
  const [wizard, setWizard] = useState<{
    requestId: string
    items: OrderRequestItemView[]
    index: number
  } | null>(null)
  // The exact phrase the wizard last auto-filled into the search box. While the
  // box still holds it verbatim, the catalog ranks by the item's bilingual
  // `terms` (soft); the moment the rep edits the box, it becomes a normal hard
  // `q` search (their explicit override). Null when no wizard phrase is staged.
  const [wizardSearch, setWizardSearch] = useState<string | null>(null)

  // Handoff from a card's "Create order" button (/products?orderFromCard=<id>):
  // fetch the card, prefill the New Order dialog with its linked client + the
  // VERBATIM client message (message.orderRequest), open it, and strip the
  // param so a refresh / back-nav doesn't re-trigger.
  const [cardPrefill, setCardPrefill] = useState<{
    clientId: string | null
    rawText: string
  } | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const cardId = params.get("orderFromCard")
    if (!cardId) return
    window.history.replaceState(null, "", window.location.pathname)
    void (async () => {
      try {
        const res = await fetch(`/api/cards?id=${encodeURIComponent(cardId)}`)
        if (!res.ok) return
        const { card } = await res.json()
        setCardPrefill({
          clientId: card?.clients?.[0]?.id ?? null,
          rawText: card?.message?.orderRequest ?? "",
        })
        setRequestDialogOpen(true)
      } catch {
        /* ignore — just don't auto-open the dialog */
      }
    })()
  }, [])

  // Pre-narrow the catalog for one intent item. Discovery items apply their
  // structured filters; the item's bilingual `searchTerms` rank the catalog
  // (sent as the `terms` param in `load`) for both modes. We ALSO seed the
  // visible search box with a human-readable phrase (the item label, else its
  // first term) so the rep can SEE what's being matched and edit it on the
  // spot — the key lever when a transliteration misses the Latin catalog.
  // While the box still holds this exact phrase, matching stays on the soft
  // `terms` ranking; editing the box switches to a hard `q` search.
  const applyItemToFilters = useCallback((item: OrderRequestItemView) => {
    const f = item.filters ?? {}
    const min = f.priceMin != null ? String(f.priceMin) : ""
    const max = f.priceMax != null ? String(f.priceMax) : ""
    const phrase =
      (item.label ?? "").trim() || item.searchTerms[0]?.trim() || ""
    setSearchInput(phrase)
    setWizardSearch(phrase)
    setPriceMinInput(min)
    setPriceMaxInput(max)
    setAwardsInput("")
    // Search V2: the LLM's attribute guesses are NO LONGER pushed into the hard
    // dropdown filters — they ride as SOFT hints in `load()` (boosts that can't
    // zero the step). Only the price ceiling/floor stays a real gate here; the
    // wizard strip still shows the applied-attribute chips from item.filters.
    setFilters({
      ...EMPTY_FILTERS,
      q: phrase,
      priceMin: min,
      priceMax: max,
    })
    setPage(1)
  }, [])

  const startAssembly = useCallback(
    async (requestId: string) => {
      try {
        const res = await fetch(
          `/api/order-requests?id=${encodeURIComponent(requestId)}`,
        )
        if (!res.ok) {
          toast.error("Не удалось загрузить разобранный запрос")
          return
        }
        const { request } = (await res.json()) as {
          request: {
            clientId: string
            comment: string | null
            parseError: string | null
            items: OrderRequestItemView[]
          }
        }

        // Mint an empty draft up front so the order is durable + linkable from
        // the start, then drive the existing builder in edit mode on it.
        const oRes = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: request.clientId,
            description: request.comment ?? "",
            items: [],
          }),
        })
        const oData = await oRes.json().catch(() => ({}))
        if (!oRes.ok) {
          toast.error(oData.error || "Не удалось создать черновик заказа")
          return
        }
        const orderId = oData.id as string
        await fetch("/api/order-requests", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: requestId, action: "linkOrder", orderId }),
        }).catch(() => {})

        await builder.openEdit(orderId)
        setTab("catalog")

        if (request.items.length === 0) {
          toast.message(
            request.parseError
              ? "Не удалось разобрать запрос — создайте заказ вручную."
              : "Товарные позиции не найдены — создайте заказ вручную.",
          )
          return
        }
        setWizard({ requestId, items: request.items, index: 0 })
        applyItemToFilters(request.items[0])
      } catch {
        toast.error("Не удалось запустить мастер")
      }
    },
    [builder, applyItemToFilters],
  )

  // Stamp the current item's outcome and advance, or end the walkthrough.
  const advanceWizard = useCallback(
    (status: "added" | "skipped") => {
      setWizard((w) => {
        if (!w) return w
        const item = w.items[w.index]
        if (item) {
          fetch("/api/order-requests", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: w.requestId,
              action: "itemStatus",
              itemId: item.id,
              status,
            }),
          }).catch(() => {})
        }
        const next = w.index + 1
        if (next >= w.items.length) {
          fetch("/api/order-requests", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: w.requestId,
              action: "status",
              status: "done",
            }),
          }).catch(() => {})
          toast.success("Все позиции проверены — проверьте заказ и отправьте его.")
          return null
        }
        applyItemToFilters(w.items[next])
        return { ...w, index: next }
      })
    },
    [applyItemToFilters],
  )

  const closeWizard = useCallback(() => {
    setWizard((w) => {
      if (w) {
        fetch("/api/order-requests", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: w.requestId,
            action: "status",
            status: "done",
          }),
        }).catch(() => {})
      }
      return null
    })
  }, [])

  // The parsed quantity for the current step prefills the add-to-order field.
  const currentWizardItem = wizard ? wizard.items[wizard.index] : null
  const addDefaultQty = currentWizardItem
    ? parseQtyHint(currentWizardItem.quantityHint)
    : 1
  // The catalog is ranked best-first while a wizard step is active, so the top
  // row of page 1 is the most probable match — flag it for the rep. Suppressed
  // when the top row scored 0 (terms matched nothing → it's filler, not a
  // match), so we never label an arbitrary product as the "Best match".
  const showBestMatch =
    !!currentWizardItem?.searchTerms?.length &&
    page === 1 &&
    (rows[0]?.score ?? 0) > 0

  // Guards against an out-of-order response overwriting a newer one.
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      })
      // While the box still holds the untouched wizard phrase, the catalog is
      // driven by the item's SOFT `terms` ranking (below) — not a hard `q`
      // filter — so a no-match item still shows products. Once the rep edits
      // the box, `filters.q` diverges from `wizardSearch` and it becomes a
      // normal hard `q` search (their explicit override).
      const boxIsWizardPhrase =
        !!wizard && wizardSearch !== null && filters.q === wizardSearch
      if (filters.q && !boxIsWizardPhrase) params.set("q", filters.q)
      if (filters.category !== ALL) params.set("category", filters.category)
      if (filters.type !== ALL) params.set("type", filters.type)
      if (filters.color !== ALL) params.set("color", filters.color)
      if (filters.sugar !== ALL) params.set("sugar", filters.sugar)
      if (filters.year !== ALL) params.set("year", filters.year)
      if (filters.aging !== ALL) params.set("aging", filters.aging)
      if (filters.bottleVolume !== ALL)
        params.set("bottleVolume", filters.bottleVolume)
      if (filters.countryName !== ALL)
        params.set("countryName", filters.countryName)
      if (filters.appelacion !== ALL)
        params.set("appelacion", filters.appelacion)
      if (filters.rating !== ALL) params.set("rating", filters.rating)
      if (filters.awards) params.set("awards", filters.awards)
      if (filters.priceMin) params.set("priceMin", filters.priceMin)
      if (filters.priceMax) params.set("priceMax", filters.priceMax)
      // The order builder's "only products in stock" guard constrains the
      // catalog to in-stock rows at the QUERY level — find by relevance (terms
      // / q / filters all still apply), then drop anything not on stock. It
      // overrides the manual "In stock" dropdown while active, and works in
      // both manual and AI-assisted (request wizard) flows since both share
      // this `load`. Previously `stockOnly` only disabled the per-row Add
      // button, so out-of-stock rows still cluttered the list.
      if (builder.stockOnly) params.set("inStock", "in")
      else if (filters.inStock !== ALL) params.set("inStock", filters.inStock)
      // Rank the catalog by the current item's bilingual search tokens, but
      // only while the box still shows the auto-filled phrase — once the rep
      // takes over the box (hard `q` above), the wizard ranking steps aside.
      const wizardTerms = boxIsWizardPhrase
        ? (wizard?.items[wizard.index]?.searchTerms ?? [])
        : []
      if (wizardTerms.length > 0) params.set("terms", wizardTerms.join(","))
      // The wizard runs PURE text search now (terms above) — the LLM's catalog
      // attributes (category/type/color/…) are deliberately NOT sent as filters
      // OR hints: the source data mis-attributes them (e.g. category="Вино" is a
      // near-empty bucket), so they only zeroed/contaminated results. Price IS
      // still applied (a reliable client-stated ceiling) via filters.priceMin/Max
      // above; the rep adds a kind/colour facet by hand from the dropdowns.
      // Merch (glasses / water / syrups / gift-wrap) is hidden from the catalog
      // by default; the toggle opts back in.
      if (includeMerch) params.set("includeMerch", "1")
      const res = await fetch(`/api/products?${params.toString()}`)
      const data: ListProductsResult = await res.json()
      if (reqId !== reqIdRef.current) return
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [page, pageSize, filters, wizard, wizardSearch, builder.stockOnly, includeMerch])

  useEffect(() => {
    load()
  }, [load])

  // When the builder closes by any path (saved, sent, discarded), drop the
  // wizard strip so it never lingers over an inactive order.
  useEffect(() => {
    if (!builder.isActive && wizard) setWizard(null)
  }, [builder.isActive, wizard])

  // Toggling the "only products in stock" guard changes the result set size —
  // reset to page 1 so a shrink can't strand the user on a now-empty high page.
  useEffect(() => {
    setPage(1)
  }, [builder.stockOnly])

  // Once the wizard is gone, clear the auto-filled search phrase so it doesn't
  // linger as a stray hard `q` filter over the plain catalog.
  useEffect(() => {
    if (!wizard && wizardSearch !== null) {
      setWizardSearch(null)
      setSearchInput("")
    }
  }, [wizard, wizardSearch])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">ЗАКАЗЫ & ПРОДУКТЫ</h1>

      <div className="w-full max-w-7xl px-4">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          {/* One "New order" entry point (both tabs). The dialog branches on
              whether a client request was pasted: empty → manual builder;
              filled → LLM split + assembly wizard. */}
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="catalog">Каталог товаров</TabsTrigger>
              <TabsTrigger value="orders">Заказы</TabsTrigger>
            </TabsList>
            <Button
              size="sm"
              onClick={() => setRequestDialogOpen(true)}
              disabled={builder.isActive}
            >
              <Plus className="h-4 w-4 mr-1" />
              Новый заказ
            </Button>
          </div>

          <TabsContent value="catalog" className="mt-4 space-y-4">
            {/* Block order during AI-assisted assembly: the order being built
                (Edit order) on top, then the per-item stepper, then the
                catalog + filters below. */}
            <OrderBuilderPanel builder={builder} />
            {wizard && currentWizardItem && builder.isActive && (
              <OrderRequestWizardStrip
                step={wizard.index}
                total={wizard.items.length}
                item={currentWizardItem}
                onSkip={() => advanceWizard("skipped")}
                onNext={() => advanceWizard("added")}
                onSkipRest={closeWizard}
                onClose={closeWizard}
              />
            )}
            <Card>
              <CardHeader>
                <CardTitle>Каталог товаров</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Top row: search + clear-all. */}
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Поиск товаров…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="flex-1 min-w-60"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAll}
                    disabled={!filtersActive}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Очистить
                  </Button>
                </div>

                {/* Filter grid. Every control filters server-side over the whole
                catalog; several can be combined at once. */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-2">
                  <FilterField label="Категория">
                    <FilterSelect
                      value={filters.category}
                      onChange={(v) => setSelect("category", v)}
                      options={categories}
                    />
                  </FilterField>
                  <FilterField label="Тип">
                    <FilterSelect
                      value={filters.type}
                      onChange={(v) => setSelect("type", v)}
                      options={options.type}
                    />
                  </FilterField>
                  <FilterField label="Цвет">
                    <FilterSelect
                      value={filters.color}
                      onChange={(v) => setSelect("color", v)}
                      options={options.color}
                    />
                  </FilterField>
                  <FilterField label="Сахар">
                    <FilterSelect
                      value={filters.sugar}
                      onChange={(v) => setSelect("sugar", v)}
                      options={options.sugar}
                    />
                  </FilterField>
                  <FilterField label="Страна">
                    <FilterSelect
                      value={filters.countryName}
                      onChange={(v) => setSelect("countryName", v)}
                      options={options.countryName}
                    />
                  </FilterField>
                  <FilterField label="Год">
                    <FilterSelect
                      value={filters.year}
                      onChange={(v) => setSelect("year", v)}
                      options={options.year}
                    />
                  </FilterField>
                  <FilterField label="Выдержка (лет)">
                    <FilterSelect
                      value={filters.aging}
                      onChange={(v) => setSelect("aging", v)}
                      options={options.aging}
                    />
                  </FilterField>
                  <FilterField label="Объём бутылки (мл)">
                    <FilterSelect
                      value={filters.bottleVolume}
                      onChange={(v) => setSelect("bottleVolume", v)}
                      options={options.bottleVolume}
                    />
                  </FilterField>
                  <FilterField label="Аппелласьон">
                    <FilterSelect
                      value={filters.appelacion}
                      onChange={(v) => setSelect("appelacion", v)}
                      options={options.appelacion}
                    />
                  </FilterField>
                  <FilterField label="Рейтинг">
                    <FilterSelect
                      value={filters.rating}
                      onChange={(v) => setSelect("rating", v)}
                      options={options.rating}
                    />
                  </FilterField>
                  <FilterField label="В наличии">
                    <Select
                      value={filters.inStock}
                      onValueChange={(v) => setSelect("inStock", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Все" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>Все</SelectItem>
                        <SelectItem value="in">В наличии</SelectItem>
                        <SelectItem value="out">Нет в наличии</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label="Награды (содержит)">
                    <Input
                      placeholder="напр. Gold, 91/100…"
                      value={awardsInput}
                      onChange={(e) => setAwardsInput(e.target.value)}
                    />
                  </FilterField>
                  <FilterField label="Цена от (₽)">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      placeholder="от"
                      value={priceMinInput}
                      onChange={(e) => setPriceMinInput(e.target.value)}
                    />
                  </FilterField>
                  <FilterField label="Цена до (₽)">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      placeholder="до"
                      value={priceMaxInput}
                      onChange={(e) => setPriceMaxInput(e.target.value)}
                    />
                  </FilterField>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    {total === 0
                      ? "Нет товаров"
                      : `${rangeStart}–${rangeEnd} из ${total.toLocaleString()} товаров`}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <Checkbox
                      checked={includeMerch}
                      onCheckedChange={(v) => {
                        setIncludeMerch(v === true)
                        setPage(1)
                      }}
                    />
                    Показывать не-напитки (бокалы, вода, аксессуары)
                  </label>
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Фото</TableHead>
                        <TableHead>Название</TableHead>
                        <TableHead>Категория</TableHead>
                        <TableHead className="text-right w-28">Цена</TableHead>
                        <TableHead className="text-right w-24">Остаток</TableHead>
                        <TableHead className="w-20 text-center">Стр.</TableHead>
                        <TableHead className="w-20 text-center">Инфо</TableHead>
                        {showAddCol && (
                          <TableHead className="w-24 text-center">
                            В заказ
                          </TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell
                            colSpan={catalogColSpan}
                            className="h-40 text-center"
                          >
                            <Loader className="animate-spin h-6 w-6 mx-auto" />
                          </TableCell>
                        </TableRow>
                      ) : rows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={catalogColSpan}
                            className="h-40 text-center text-muted-foreground"
                          >
                            {filtersActive
                              ? "Нет товаров по заданным фильтрам."
                              : "Пока нет товаров."}
                          </TableCell>
                        </TableRow>
                      ) : (
                        rows.map((p, idx) => (
                          <TableRow key={p.id}>
                            <TableCell>
                              {p.imageUrl ? (
                                <HoverCard openDelay={150} closeDelay={100}>
                                  <HoverCardTrigger asChild>
                                    {/* Catalog images are remote (ast.wine
                                    CDN); plain <img> avoids next/image
                                    remote-host config for an arbitrary
                                    import set. */}
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={p.imageUrl}
                                      alt={p.name}
                                      className="h-10 w-10 rounded object-cover bg-muted cursor-zoom-in"
                                      loading="lazy"
                                    />
                                  </HoverCardTrigger>
                                  <HoverCardContent
                                    side="right"
                                    className="w-auto p-2"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={p.imageUrl}
                                      alt={p.name}
                                      className="max-h-80 max-w-80 rounded object-contain bg-muted"
                                    />
                                  </HoverCardContent>
                                </HoverCard>
                              ) : (
                                <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                                  <ImageOff className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">
                              <span className="inline-flex items-center gap-2">
                                {p.name}
                                {showBestMatch && idx === 0 && (
                                  <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
                                    Лучшее совпадение
                                  </Badge>
                                )}
                              </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {p.category ?? "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatPrice(p.price)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {p.totalStock ?? "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              {p.webPageUrl ? (
                                <a
                                  href={p.webPageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-orange-400 hover:underline inline-flex items-center"
                                  aria-label={`Открыть страницу ${p.name}`}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <ProductDetailDialog
                                productId={p.id}
                                trigger={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Подробная информация: ${p.name}`}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                }
                              />
                            </TableCell>
                            {showAddCol && (
                              <TableCell className="text-center">
                                <AddToOrderButton
                                  defaultQty={addDefaultQty}
                                  disabled={
                                    builder.stockOnly &&
                                    (p.totalStock == null || p.totalStock <= 0)
                                  }
                                  onAdd={(qty) =>
                                    builder.addProduct(
                                      {
                                        id: p.id,
                                        name: p.name,
                                        price: p.price,
                                        stock: p.totalStock,
                                      },
                                      qty,
                                    )
                                  }
                                />
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Строк на странице
                    </span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => {
                        setPageSize(Number(v))
                        setPage(1)
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {totalPages > 1 && (
                    <Pagination className="mx-0 w-auto justify-end">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={(e) => {
                              e.preventDefault()
                              if (page > 1) setPage(page - 1)
                            }}
                            aria-disabled={page === 1}
                            className={
                              page === 1
                                ? "pointer-events-none opacity-50"
                                : "cursor-pointer"
                            }
                          />
                        </PaginationItem>
                        <PaginationItem>
                          <span className="flex h-9 items-center px-3 text-sm text-muted-foreground">
                            Страница {page} из {totalPages}
                          </span>
                        </PaginationItem>
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
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Заказы</CardTitle>
              </CardHeader>
              <CardContent>
                <OrdersTable
                  onEditOrder={editOrder}
                  refreshKey={ordersRefresh}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <NewOrderDialog
        open={requestDialogOpen}
        onOpenChange={(o) => {
          setRequestDialogOpen(o)
          if (!o) setCardPrefill(null)
        }}
        onManual={startManualOrder}
        onAssemble={startAssembly}
        initialClientId={cardPrefill?.clientId ?? null}
        initialRawText={cardPrefill?.rawText ?? null}
      />
    </div>
  )
}
