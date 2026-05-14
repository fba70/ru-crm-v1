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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { authClient } from "@/lib/auth-client"
import { Loader, RefreshCcw } from "lucide-react"
import AdminEditUserDialog from "@/components/forms/form-admin-edit-user"
import AdminSetPasswordDialog from "@/components/forms/form-admin-set-password"
import AdminSetRoleDialog from "@/components/forms/form-admin-set-role"
import AdminBanUserDialog from "@/components/forms/form-admin-ban-user"
import AdminSetOrgRoleDialog from "@/components/forms/form-admin-set-org-role"
import type { UserOrgInfo } from "@/app/api/admin/user-organizations/route"

type AdminUser = {
  id: string
  name: string
  email: string
  role: string
  banned: boolean
  banReason?: string | null
  banExpires?: string | Date | null
  createdAt: string | Date
  updatedAt: string | Date
}

const ITEMS_PER_PAGE = 10

export function TableAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [userOrgMap, setUserOrgMap] = useState<Record<string, string>>({})
  const [userOrgDetails, setUserOrgDetails] = useState<Record<string, UserOrgInfo[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  // Filters
  const [searchName, setSearchName] = useState("")
  const [searchEmail, setSearchEmail] = useState("")
  const [searchOrg, setSearchOrg] = useState("")
  const [filterRole, setFilterRole] = useState("all")

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query: {
        limit: number
        offset: number
        sortBy: string
        sortDirection: "asc" | "desc"
        searchValue?: string
        searchField?: "name" | "email"
        searchOperator?: "contains"
        filterField?: string
        filterValue?: string
        filterOperator?: "eq"
      } = {
        limit: ITEMS_PER_PAGE,
        offset: (page - 1) * ITEMS_PER_PAGE,
        sortBy: "createdAt",
        sortDirection: "desc",
      }

      if (searchName) {
        query.searchValue = searchName
        query.searchField = "name"
        query.searchOperator = "contains"
      } else if (searchEmail) {
        query.searchValue = searchEmail
        query.searchField = "email"
        query.searchOperator = "contains"
      }

      if (filterRole !== "all") {
        query.filterField = "role"
        query.filterValue = filterRole
        query.filterOperator = "eq"
      }

      const { data, error: fetchError } =
        await authClient.admin.listUsers({ query })

      if (fetchError) {
        setError(fetchError.message || "Failed to fetch users")
        return
      }

      setUsers((data?.users as unknown as AdminUser[]) ?? [])
      setTotal(data?.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [page, searchName, searchEmail, filterRole])

  const fetchOrgMap = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/user-organizations")
      if (res.ok) {
        const data = await res.json()
        setUserOrgMap(data.userOrgMap ?? {})
        setUserOrgDetails(data.userOrgDetails ?? {})
      }
    } catch {
      // Non-critical, org names just won't show
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  useEffect(() => {
    fetchOrgMap()
  }, [fetchOrgMap])

  const refresh = () => {
    fetchUsers()
    fetchOrgMap()
  }

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  if (error) {
    return (
      <div className="text-red-500 text-lg">
        Error loading users: {error}
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
            setSearchEmail("")
            setPage(1)
          }}
          className="max-w-48"
        />
        <Input
          placeholder="Search by email"
          value={searchEmail}
          onChange={(e) => {
            setSearchEmail(e.target.value)
            setSearchName("")
            setPage(1)
          }}
          className="max-w-48"
        />
        <Input
          placeholder="Search by organization"
          value={searchOrg}
          onChange={(e) => {
            setSearchOrg(e.target.value)
            setPage(1)
          }}
          className="max-w-48"
        />
        <Select
          value={filterRole}
          onValueChange={(val) => {
            setFilterRole(val)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Filter role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={refresh}>
          <RefreshCcw className="h-4 w-4" />
        </Button>
        <span className="ml-auto text-sm text-gray-400">
          {total} user{total !== 1 && "s"} total
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
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Banned</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                const filteredUsers = searchOrg
                  ? users.filter((u) =>
                      userOrgMap[u.id]
                        ?.toLowerCase()
                        .includes(searchOrg.toLowerCase()),
                    )
                  : users
                return filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-gray-500">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          user.role === "admin" ? "default" : "secondary"
                        }
                      >
                        {user.role || "user"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.banned ? (
                        <Badge variant="destructive">Banned</Badge>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-48 truncate">
                      {userOrgMap[user.id] || (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <AdminEditUserDialog
                          user={user}
                          onSuccess={refresh}
                        />
                        <AdminSetPasswordDialog
                          userId={user.id}
                          userName={user.name}
                          onSuccess={refresh}
                        />
                        <AdminSetRoleDialog
                          userId={user.id}
                          userName={user.name}
                          currentRole={user.role || "user"}
                          onSuccess={refresh}
                        />
                        {userOrgDetails[user.id]?.length > 0 && (
                          <AdminSetOrgRoleDialog
                            userName={user.name}
                            orgDetails={userOrgDetails[user.id]}
                            onSuccess={refresh}
                          />
                        )}
                        {user.role !== "admin" && (
                          <AdminBanUserDialog
                            userId={user.id}
                            userName={user.name}
                            isBanned={user.banned}
                            onSuccess={refresh}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )
              })()}
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
