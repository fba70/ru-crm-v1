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
import { ExternalLink, ImageOff, Loader, X } from "lucide-react"
import type { ProductRow, ListProductsResult } from "@/app/api/products/route"

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
const DEFAULT_PAGE_SIZE = 10
// Sentinel for the "all categories" Select option (shadcn SelectItem
// can't take an empty-string value).
const ALL_CATEGORIES = "__all__"

// Format a numeric price with thin-space grouping (matches the catalog's
// RU locale). Null prices render as a dash.
function formatPrice(price: number | null): string {
  if (price === null) return "—"
  return price.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export default function ProductsPage() {
  const [rows, setRows] = useState<ProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  // `search` is the live input value; `query` is the debounced value that
  // actually drives the server fetch.
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const [categories, setCategories] = useState<string[]>([])
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)

  // Debounce the search box → server query. Resets to page 1 on change.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  // Distinct category list for the filter — fetched once on mount.
  useEffect(() => {
    let cancelled = false
    fetch("/api/products?categories=1")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setCategories(data.categories ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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
      if (query) params.set("q", query)
      if (category !== ALL_CATEGORIES) params.set("category", category)
      const res = await fetch(`/api/products?${params.toString()}`)
      const data: ListProductsResult = await res.json()
      if (reqId !== reqIdRef.current) return
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [page, query, category, pageSize])

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
        <Card>
          <CardHeader>
            <CardTitle>Product Catalog</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 min-w-60"
              />
              <Select
                value={category}
                onValueChange={(v) => {
                  setCategory(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-fit min-w-48">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("")
                  setCategory(ALL_CATEGORIES)
                  setPage(1)
                }}
                disabled={search === "" && category === ALL_CATEGORIES}
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-40 text-center">
                        <Loader className="animate-spin h-6 w-6 mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-40 text-center text-muted-foreground"
                      >
                        {query
                          ? "No products match the search."
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
                        <TableCell className="font-medium">{p.name}</TableCell>
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
      </div>
    </div>
  )
}
