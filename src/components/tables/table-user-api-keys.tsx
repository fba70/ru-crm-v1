"use client"

import { useEffect, useState } from "react"
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
import type { ApiKey } from "@/db/schema"
import CreateApiKeyDialog from "@/components/forms/form-create-api-key"
import { toast } from "sonner"
import { Loader, RefreshCcw } from "lucide-react"

const ITEMS_PER_PAGE = 5

export function TableUserApiKeys() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [sortAsc, setSortAsc] = useState(false)
  const [searchName, setSearchName] = useState("")
  const [keyChange, setKeyChange] = useState(0)

  useEffect(() => {
    async function fetchApiKeys() {
      try {
        const res = await fetch("/api/auth/keys")
        if (!res.ok) {
          throw new Error("Failed to fetch API keys")
        }
        const data = await res.json()
        // console.log("Fetched API keys:", data)
        const keys = data.data?.apiKeys ?? data.data ?? []
        setApiKeys(Array.isArray(keys) ? keys : [])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    }

    fetchApiKeys()
  }, [keyChange])

  // Filter by invoice_number and total_amount
  const filteredKeys = apiKeys.filter((item) => {
    const nameMatch = item.name
      ?.toLowerCase()
      .includes(searchName.toLowerCase())
    return nameMatch
  })

  // Sort by created_at
  const sortedKeys = [...filteredKeys].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return sortAsc ? dateA - dateB : dateB - dateA
  })

  // Pagination
  const totalPages = Math.ceil(sortedKeys.length / ITEMS_PER_PAGE)
  const paginatedKeys = sortedKeys.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  const getStatus = (expiresAt: Date | null) => {
    if (!expiresAt) return { text: "OK", color: "text-green-500" }

    const now = new Date()
    const expiry = new Date(expiresAt)
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    if (now > expiry) {
      return { text: "Expired", color: "text-red-500" }
    } else if (expiry <= oneWeekFromNow) {
      return { text: "Expires soon", color: "text-orange-500" }
    } else {
      return { text: "OK", color: "text-green-500" }
    }
  }

  const handleDelete = async (keyId: string) => {
    try {
      const res = await fetch(`/api/auth/keys?keyId=${keyId}`, {
        method: "DELETE",
      })
      if (res.ok) {
        toast.success("API key deleted successfully")
        setKeyChange((prev) => prev + 1)
      } else {
        const errorData = await res.json()
        toast.error(errorData.error || "Failed to delete API key")
      }
    } catch (err) {
      console.error("Network error:", err)
      toast.error("Network error")
    }
  }

  if (error) {
    return (
      <div className="text-red-500 text-lg">
        Error loading keys data: {error}
      </div>
    )
  }

  return (
    <>
      {loading ? (
        <Loader className="animate-spin h-6 w-6 text-gray-900 dark:text-gray-100" />
      ) : (
        <>
          <div className="flex flex-row items-center justify-between gap-2 mb-4">
            <div className="flex flex-row items-center justify-center gap-2">
              <Input
                placeholder="Search key name"
                type="text"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className="max-w-xs"
              />
              <Button variant="outline" onClick={() => setSortAsc(!sortAsc)}>
                Sort by Date {sortAsc ? "↑" : "↓"}
              </Button>
            </div>

            <CreateApiKeyDialog
              onSuccess={() => setKeyChange((prev) => prev + 1)}
            />

            <Button
              variant="outline"
              onClick={() => setKeyChange(keyChange + 1)}
            >
              <RefreshCcw />
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key name</TableHead>
                <TableHead>Created at</TableHead>
                <TableHead>Expires at</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedKeys.map((key) => {
                const status = getStatus(key.expiresAt)
                return (
                  <TableRow key={key.id}>
                    <TableCell>{key.name}</TableCell>
                    <TableCell>
                      {new Date(key.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {key.expiresAt
                        ? new Date(key.expiresAt).toLocaleString()
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <span className={status.color}>{status.text}</span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        onClick={() => handleDelete(key.id)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
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
      )}
    </>
  )
}
