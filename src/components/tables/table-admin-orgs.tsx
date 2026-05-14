"use client"

import { useEffect, useState, useCallback } from "react"
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
import { Loader, RefreshCcw } from "lucide-react"
import AdminEditOrgDialog from "@/components/forms/form-admin-edit-org"
import type { AdminOrg } from "@/app/api/admin/organizations/route"

const ITEMS_PER_PAGE = 10

export function TableAdminOrgs() {
  const [orgs, setOrgs] = useState<AdminOrg[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [searchName, setSearchName] = useState("")

  const fetchOrgs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(ITEMS_PER_PAGE),
        offset: String((page - 1) * ITEMS_PER_PAGE),
      })
      if (searchName) {
        params.set("searchName", searchName)
      }

      const res = await fetch(`/api/admin/organizations?${params}`)
      if (!res.ok) {
        throw new Error("Failed to fetch organizations")
      }
      const data = await res.json()
      setOrgs(data.organizations ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [page, searchName])

  useEffect(() => {
    fetchOrgs()
  }, [fetchOrgs])

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  if (error) {
    return (
      <div className="text-red-500 text-lg">
        Error loading organizations: {error}
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-row flex-wrap items-center gap-2 mb-4">
        <Input
          placeholder="Search by name"
          value={searchName}
          onChange={(e) => {
            setSearchName(e.target.value)
            setPage(1)
          }}
          className="max-w-48"
        />
        <Button variant="outline" onClick={fetchOrgs}>
          <RefreshCcw className="h-4 w-4" />
        </Button>
        <span className="ml-auto text-sm text-gray-400">
          {total} organization{total !== 1 && "s"} total
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center p-8">
          <Loader className="animate-spin h-6 w-6 text-gray-900 dark:text-gray-100" />
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Owner Email</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-gray-500">
                    No organizations found
                  </TableCell>
                </TableRow>
              ) : (
                orgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell>
                      {new Date(org.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>{org.memberCount}</TableCell>
                    <TableCell>
                      {org.ownerName || (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {org.ownerEmail || (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <AdminEditOrgDialog org={org} onSuccess={fetchOrgs} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-end gap-4 mt-4">
            <span className="text-sm text-gray-400">
              page {page} of {totalPages || 1}
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
                disabled={page >= totalPages}
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
