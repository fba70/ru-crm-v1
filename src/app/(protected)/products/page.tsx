"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
import { ProductDetailDialog } from "@/components/blocks/product-detail-dialog"
import { OrdersTable } from "@/components/blocks/orders-table"
import {
  useOrderBuilder,
  OrderBuilderPanel,
  AddToOrderButton,
} from "@/components/blocks/order-builder"
import { ExternalLink, Eye, ImageOff, Loader, Plus, X } from "lucide-react"
import type {
  ProductRow,
  ListProductsResult,
  ProductFilterOptions,
} from "@/app/api/products/route"

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
        <SelectValue placeholder="All" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All</SelectItem>
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
    filters.inStock !== ALL

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

  const startNewOrder = () => {
    builder.openNew()
    setTab("catalog")
  }
  const editOrder = (id: string) => {
    builder.openEdit(id)
    setTab("catalog")
  }

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
      if (filters.q) params.set("q", filters.q)
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
      if (filters.inStock !== ALL) params.set("inStock", filters.inStock)
      const res = await fetch(`/api/products?${params.toString()}`)
      const data: ListProductsResult = await res.json()
      if (reqId !== reqIdRef.current) return
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [page, pageSize, filters])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">PRODUCTS</h1>

      <div className="w-full max-w-7xl px-4">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          {/* New order is available from both tabs; it opens the builder and
              switches to the Catalog tab (where the product picker lives). */}
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="catalog">Product Catalog</TabsTrigger>
              <TabsTrigger value="orders">Orders</TabsTrigger>
            </TabsList>
            <Button size="sm" onClick={startNewOrder} disabled={builder.isActive}>
              <Plus className="h-4 w-4 mr-1" />
              New order
            </Button>
          </div>

          <TabsContent value="catalog" className="mt-4 space-y-4">
            <OrderBuilderPanel builder={builder} />
            <Card>
              <CardHeader>
                <CardTitle>Product Catalog</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Top row: search + clear-all. */}
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Search products…"
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
                    Clear
                  </Button>
                </div>

                {/* Filter grid. Every control filters server-side over the whole
                catalog; several can be combined at once. */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-2">
                  <FilterField label="Category">
                    <FilterSelect
                      value={filters.category}
                      onChange={(v) => setSelect("category", v)}
                      options={categories}
                    />
                  </FilterField>
                  <FilterField label="Type">
                    <FilterSelect
                      value={filters.type}
                      onChange={(v) => setSelect("type", v)}
                      options={options.type}
                    />
                  </FilterField>
                  <FilterField label="Color">
                    <FilterSelect
                      value={filters.color}
                      onChange={(v) => setSelect("color", v)}
                      options={options.color}
                    />
                  </FilterField>
                  <FilterField label="Sugar">
                    <FilterSelect
                      value={filters.sugar}
                      onChange={(v) => setSelect("sugar", v)}
                      options={options.sugar}
                    />
                  </FilterField>
                  <FilterField label="Country">
                    <FilterSelect
                      value={filters.countryName}
                      onChange={(v) => setSelect("countryName", v)}
                      options={options.countryName}
                    />
                  </FilterField>
                  <FilterField label="Year">
                    <FilterSelect
                      value={filters.year}
                      onChange={(v) => setSelect("year", v)}
                      options={options.year}
                    />
                  </FilterField>
                  <FilterField label="Aging (years)">
                    <FilterSelect
                      value={filters.aging}
                      onChange={(v) => setSelect("aging", v)}
                      options={options.aging}
                    />
                  </FilterField>
                  <FilterField label="Bottle volume (ml)">
                    <FilterSelect
                      value={filters.bottleVolume}
                      onChange={(v) => setSelect("bottleVolume", v)}
                      options={options.bottleVolume}
                    />
                  </FilterField>
                  <FilterField label="Appellation">
                    <FilterSelect
                      value={filters.appelacion}
                      onChange={(v) => setSelect("appelacion", v)}
                      options={options.appelacion}
                    />
                  </FilterField>
                  <FilterField label="Rating">
                    <FilterSelect
                      value={filters.rating}
                      onChange={(v) => setSelect("rating", v)}
                      options={options.rating}
                    />
                  </FilterField>
                  <FilterField label="In stock">
                    <Select
                      value={filters.inStock}
                      onValueChange={(v) => setSelect("inStock", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>All</SelectItem>
                        <SelectItem value="in">In stock</SelectItem>
                        <SelectItem value="out">Out of stock</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label="Awards (contains)">
                    <Input
                      placeholder="e.g. Gold, 91/100…"
                      value={awardsInput}
                      onChange={(e) => setAwardsInput(e.target.value)}
                    />
                  </FilterField>
                  <FilterField label="Price from (₽)">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      placeholder="min"
                      value={priceMinInput}
                      onChange={(e) => setPriceMinInput(e.target.value)}
                    />
                  </FilterField>
                  <FilterField label="Price to (₽)">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      placeholder="max"
                      value={priceMaxInput}
                      onChange={(e) => setPriceMaxInput(e.target.value)}
                    />
                  </FilterField>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    {total === 0
                      ? "No products"
                      : `${rangeStart}–${rangeEnd} of ${total.toLocaleString()} products`}
                  </div>
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Image</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right w-28">Price</TableHead>
                        <TableHead className="text-right w-24">Stock</TableHead>
                        <TableHead className="w-20 text-center">Page</TableHead>
                        <TableHead className="w-20 text-center">Info</TableHead>
                        {showAddCol && (
                          <TableHead className="w-24 text-center">
                            Order
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
                              ? "No products match the filters."
                              : "No products yet."}
                          </TableCell>
                        </TableRow>
                      ) : (
                        rows.map((p) => (
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
                              {p.name}
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
                                  aria-label={`Open ${p.name} page`}
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
                                    aria-label={`Full info for ${p.name}`}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                }
                              />
                            </TableCell>
                            {showAddCol && (
                              <TableCell className="text-center">
                                <AddToOrderButton
                                  onAdd={(qty) =>
                                    builder.addProduct(
                                      { id: p.id, name: p.name, price: p.price },
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
                      Rows per page
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
                            Page {page} of {totalPages}
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
                <CardTitle>Orders</CardTitle>
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
    </div>
  )
}
