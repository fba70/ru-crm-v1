"use client"

import * as React from "react"
import { useState } from "react"
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
import { RefreshCcw } from "lucide-react"

type SimplifiedUsage = {
  id: string
  createdAt: string
  amountTokens: number
  amountCurrency: number
  currency: string
  usageType: string
  usageName: string
}

const ITEMS_PER_PAGE = 5

const usage: SimplifiedUsage[] = [
  {
    id: "1",
    createdAt: "2025-12-01T10:00:00Z",
    amountTokens: 100,
    amountCurrency: 3.5,
    currency: "EUR",
    usageType: "Usage",
    usageName: "Content generation",
  },
  {
    id: "2",
    createdAt: "2025-12-07T11:30:00Z",
    amountTokens: 50,
    amountCurrency: 1.5,
    currency: "EUR",
    usageType: "Usage",
    usageName: "External sources calls",
  },
  {
    id: "3",
    createdAt: "2025-12-22T11:30:00Z",
    amountTokens: 0,
    amountCurrency: 100.0,
    currency: "EUR",
    usageType: "Subscription",
    usageName: "Monthly subscription",
  },
]

export function TableUserUsage() {
  const [page, setPage] = useState(1)
  const [sortAsc, setSortAsc] = useState(false)
  const [searchType, setSearchType] = useState("")
  const [searchName, setSearchName] = useState("")
  const [keyChange, setKeyChange] = useState(0)

  // Filter by invoice_number and total_amount
  const filteredUsage = usage.filter((usageItem) => {
    const typeMatch = usageItem.usageType
      .toLowerCase()
      .includes(searchType.toLowerCase())
    const nameMatch = usageItem.usageName
      .toLowerCase()
      .includes(searchName.toLowerCase())
    return typeMatch && nameMatch
  })

  // Sort by created_at
  const sortedUsage = [...filteredUsage].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return sortAsc ? dateA - dateB : dateB - dateA
  })

  // Pagination
  const totalPages = Math.ceil(sortedUsage.length / ITEMS_PER_PAGE)
  const paginatedUsage = sortedUsage.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  return (
    <>
      <div className="flex flex-row items-center justify-between mb-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search usage type"
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            className="max-w-xs"
          />
          <Input
            placeholder="Search usage name"
            type="text"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
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
            <TableHead>Usage date</TableHead>
            <TableHead>Usage type</TableHead>
            <TableHead>Usage name</TableHead>
            <TableHead>Amount tokens</TableHead>
            <TableHead>Amount currentcy</TableHead>
            <TableHead>Currency</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedUsage.map((usage) => (
            <TableRow key={usage.id}>
              <TableCell>
                {new Date(usage.createdAt).toLocaleString()}
              </TableCell>
              <TableCell>{usage.usageType}</TableCell>
              <TableCell>{usage.usageName}</TableCell>
              <TableCell>{usage.amountTokens}</TableCell>
              <TableCell>{usage.amountCurrency}</TableCell>
              <TableCell>{usage.currency}</TableCell>
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
