"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { Loader, Pencil, X } from "lucide-react"
import type { OrderRow, ListOrdersResult } from "@/app/api/orders/route"
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
  ORDER_STATUSES,
  formatOrderAmount,
  formatOrderDate,
} from "@/lib/orders-format"

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
const DEFAULT_PAGE_SIZE = 10

export function OrdersTable({
  // Opens the order builder for an existing order (preview / edit).
  onEditOrder,
  // Bumped by the parent after a save so the list re-fetches.
  refreshKey = 0,
}: {
  onEditOrder?: (orderId: string) => void
  refreshKey?: number
}) {
  const [rows, setRows] = useState<OrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)

  // Committed filters that drive the server fetch. `searchInput` debounces
  // into `q`; the status select commits immediately.
  const [q, setQ] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [status, setStatus] = useState<string>("__all__")

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const filtersActive = searchInput !== "" || status !== "__all__"

  const clearAll = useCallback(() => {
    setSearchInput("")
    setQ("")
    setStatus("__all__")
    setPage(1)
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
      if (q) params.set("q", q)
      if (status !== "__all__") params.set("status", status)
      const res = await fetch(`/api/orders?${params.toString()}`)
      const data: ListOrdersResult = await res.json()
      if (reqId !== reqIdRef.current) return
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [page, pageSize, q, status])

  useEffect(() => {
    // `load` already depends on the filters/page; `refreshKey` is the
    // parent-driven re-fetch trigger (bumped after a save).
    load()
  }, [load, refreshKey])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  return (
    <div className="space-y-4">
      {/* Top row: search + status + clear. Richer filters come later. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Поиск заказов…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1 min-w-60"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Все статусы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Все статусы</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      <div className="text-xs text-muted-foreground">
        {total === 0
          ? "Нет заказов"
          : `${rangeStart}–${rangeEnd} из ${total.toLocaleString()} заказов`}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Дата</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead className="text-right w-36">Итого</TableHead>
              <TableHead className="w-40">Статус</TableHead>
              <TableHead className="w-20 text-center">Открыть</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-40 text-center">
                  <Loader className="animate-spin h-6 w-6 mx-auto" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-40 text-center text-muted-foreground"
                >
                  {filtersActive
                    ? "Нет заказов по заданным фильтрам."
                    : "Пока нет заказов."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((o) => (
                <TableRow
                  key={o.id}
                  className={onEditOrder ? "cursor-pointer" : undefined}
                  onClick={
                    onEditOrder ? () => onEditOrder(o.id) : undefined
                  }
                >
                  <TableCell className="tabular-nums">
                    {formatOrderDate(o.orderDate)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {o.clientName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatOrderAmount(o.totalAmount, o.currency)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={ORDER_STATUS_COLOR[o.status] ?? ""}
                    >
                      {ORDER_STATUS_LABEL[o.status] ?? o.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Открыть заказ"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditOrder?.(o.id)
                      }}
                      disabled={!onEditOrder}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Строк на странице</span>
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
    </div>
  )
}
