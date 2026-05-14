"use client"

import { useState, useEffect } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Download, Loader, RefreshCcw } from "lucide-react"
import { toast } from "sonner"
import { PolarOrder } from "@/types/polar"

type SimplifiedOrder = {
  id: string
  createdAt: string
  paid: boolean
  netAmount: number
  taxAmount: number
  totalAmount: number
  currency: string
  invoiceNumber: string
  productName: string
}

type TableUserOrdersProps = {
  userId?: string | null
}

const ITEMS_PER_PAGE = 5

export function TableUserOrders({ userId }: TableUserOrdersProps) {
  const [orders, setOrders] = useState<SimplifiedOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState<boolean>(false)
  const [page, setPage] = useState(1)
  const [sortAsc, setSortAsc] = useState(false)
  const [searchInvoice, setSearchInvoice] = useState("")
  const [searchTotal, setSearchTotal] = useState("")
  const [keyChange, setKeyChange] = useState(0)

  useEffect(() => {
    async function fetchUserOrders() {
      if (!userId) {
        setOrders([])
        return
      }

      setOrdersLoading(true)
      try {
        const res = await fetch(
          `/api/auth/polar/orders?id=${encodeURIComponent(userId)}`
        )
        const userOrdersAllData = await res.json()

        const simplifiedOrders = (
          userOrdersAllData.result.items as PolarOrder[]
        ).map((order) => ({
          id: order.id,
          createdAt: order.createdAt,
          paid: order.paid,
          netAmount: order.netAmount,
          taxAmount: order.taxAmount,
          totalAmount: order.totalAmount,
          currency: order.currency,
          invoiceNumber: order.invoiceNumber,
          productName: order.product?.name ?? "",
        }))
        setOrders(simplifiedOrders)
      } catch (e) {
        console.error("Failed to fetch Polar user orders:", e)
        toast.error("Failed to load orders")
      } finally {
        setOrdersLoading(false)
      }
    }

    fetchUserOrders()
  }, [userId, keyChange])

  // Filter by invoice_number and total_amount
  const filteredOrders = orders.filter((order) => {
    const invoiceMatch = order.invoiceNumber
      .toLowerCase()
      .includes(searchInvoice.toLowerCase())
    const totalMatch = searchTotal
      ? order.totalAmount === Number(searchTotal)
      : true
    return invoiceMatch && totalMatch
  })

  // Sort by created_at
  const sortedOrders = [...filteredOrders].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return sortAsc ? dateA - dateB : dateB - dateA
  })

  // Pagination
  const totalPages = Math.ceil(sortedOrders.length / ITEMS_PER_PAGE)
  const paginatedOrders = sortedOrders.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE
  )

  const handleDownload = async (invoiceId: string) => {
    try {
      const res = await fetch(`/api/auth/polar/invoices?id=${invoiceId}`)
      if (!res.ok) {
        throw new Error("Failed to fetch invoice")
      }
      const data = await res.json()
      if (data.url) {
        window.open(data.url, "_blank")
        toast.success("Invoice opened in new tab")
      } else {
        toast.error("Invoice URL not available")
      }
    } catch (err) {
      console.log("Error opening invoice:", err)
      toast.error("Failed to open invoice")
    }
  }

  if (ordersLoading) {
    return (
      <Loader className="animate-spin h-6 w-6 text-gray-900 dark:text-gray-100" />
    )
  }

  return (
    <>
      <div className="flex flex-row items-center justify-between mb-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search invoice number"
            value={searchInvoice}
            onChange={(e) => setSearchInvoice(e.target.value)}
            className="max-w-xs"
          />
          <Input
            placeholder="Search total amount"
            type="number"
            value={searchTotal}
            onChange={(e) => setSearchTotal(e.target.value)}
            className="max-w-xs"
          />
          <Button variant="outline" onClick={() => setSortAsc(!sortAsc)}>
            Sort by Date {sortAsc ? "↑" : "↓"}
          </Button>
        </div>

        <Button variant="outline" onClick={() => setKeyChange(keyChange + 1)}>
          <RefreshCcw />
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Purchase date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Net</TableHead>
            <TableHead>Tax</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead>Product name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedOrders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <div className="flex flex-row gap-4 items-center justify-start">
                  {order.invoiceNumber}
                  <Button
                    variant="outline"
                    onClick={() => handleDownload(order.id)}
                  >
                    <Download size={16} />
                  </Button>
                </div>
              </TableCell>
              <TableCell>
                {new Date(order.createdAt).toLocaleString()}
              </TableCell>
              <TableCell>
                <span
                  className={
                    order.paid
                      ? "text-green-600 font-semibold"
                      : "text-orange-500 font-semibold"
                  }
                >
                  {order.paid ? "Yes" : "No"}
                </span>
              </TableCell>
              <TableCell>{order.netAmount}</TableCell>
              <TableCell>{order.taxAmount}</TableCell>
              <TableCell>{order.totalAmount}</TableCell>
              <TableCell>{order.currency.toUpperCase()}</TableCell>
              <TableCell>{order.productName}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-end gap-4 mt-4">
        <span className="text-sm text-gray-400">
          page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            previous
          </Button>
          <Button
            variant="outline"
            disabled={page === totalPages || totalPages === 0}
            onClick={() => setPage(page + 1)}
          >
            next
          </Button>
        </div>
      </div>
    </>
  )
}
