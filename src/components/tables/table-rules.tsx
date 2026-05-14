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
import { Loader, RefreshCcw, Plus, Pencil, Eye, Trash2 } from "lucide-react"
import { toast } from "sonner"
import RuleEditDialog from "@/components/forms/form-rule-edit"
import type { RuleRow } from "@/app/api/rules/route"
import type { RuleType } from "@/db/schema"

type Props = {
  ruleType: RuleType
  canEdit: boolean
  showUserColumn: boolean
  showOrgFilter: boolean
  showOrgColumn: boolean
}

export function TableRules({
  ruleType,
  canEdit,
  showUserColumn,
  showOrgFilter,
  showOrgColumn,
}: Props) {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchName, setSearchName] = useState("")
  const [searchOrg, setSearchOrg] = useState("")

  const fetchRules = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ type: ruleType })
      if (searchName) params.set("search", searchName)
      const res = await fetch(`/api/rules?${params}`)
      if (!res.ok) throw new Error("Failed to fetch rules")
      const data = await res.json()
      setRules(data.rules ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [ruleType, searchName])

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  const visibleRules = showOrgFilter && searchOrg
    ? rules.filter((r) =>
        (r.organizationName ?? "")
          .toLowerCase()
          .includes(searchOrg.toLowerCase()),
      )
    : rules

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this rule?")) return
    try {
      const res = await fetch(`/api/rules?id=${id}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || "Failed to delete rule")
        return
      }
      toast.success("Rule deleted")
      fetchRules()
    } catch {
      toast.error("Failed to delete rule")
    }
  }

  if (error) {
    return (
      <div className="text-red-500 text-lg">Error loading rules: {error}</div>
    )
  }

  const colCount =
    2 +
    (showUserColumn ? 1 : 0) +
    (showOrgColumn ? 1 : 0) +
    2 +
    1

  return (
    <>
      <div className="flex flex-row flex-wrap items-center gap-2 mb-4">
        <Input
          placeholder="Search by name"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          className="max-w-48"
        />
        {showOrgFilter && (
          <Input
            placeholder="Filter by organization"
            value={searchOrg}
            onChange={(e) => setSearchOrg(e.target.value)}
            className="max-w-56"
          />
        )}
        <Button variant="outline" onClick={fetchRules}>
          <RefreshCcw className="h-4 w-4" />
        </Button>
        <span className="ml-auto text-sm text-gray-400">
          {visibleRules.length} rule{visibleRules.length !== 1 && "s"}
        </span>
        {canEdit && (
          <RuleEditDialog
            mode="create"
            ruleType={ruleType}
            canEdit
            onSuccess={fetchRules}
            trigger={
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New rule
              </Button>
            }
          />
        )}
      </div>

      {loading ? (
        <div className="flex justify-center p-8">
          <Loader className="animate-spin h-6 w-6 text-gray-900 dark:text-gray-100" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {showUserColumn && <TableHead>Created by</TableHead>}
              {showOrgColumn && <TableHead>Organization</TableHead>}
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRules.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="text-center text-gray-500"
                >
                  No rules found
                </TableCell>
              </TableRow>
            ) : (
              visibleRules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  {showUserColumn && (
                    <TableCell>
                      {r.userName || <span className="text-gray-400">-</span>}
                    </TableCell>
                  )}
                  {showOrgColumn && (
                    <TableCell>
                      {r.organizationName || (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <RuleEditDialog
                        mode="edit"
                        ruleType={ruleType}
                        rule={r}
                        canEdit={canEdit}
                        onSuccess={fetchRules}
                        trigger={
                          <Button variant="ghost" size="sm">
                            {canEdit ? (
                              <Pencil className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        }
                      />
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(r.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </>
  )
}
