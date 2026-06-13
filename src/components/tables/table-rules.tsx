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

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
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
      if (!res.ok) throw new Error("Не удалось загрузить правила")
      const data = await res.json()
      setRules(data.rules ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка")
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
    if (!confirm("Удалить это правило?")) return
    try {
      const res = await fetch(`/api/rules?id=${id}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || "Не удалось удалить правило")
        return
      }
      toast.success("Правило удалено")
      fetchRules()
    } catch {
      toast.error("Не удалось удалить правило")
    }
  }

  if (error) {
    return (
      <div className="text-red-500 text-lg">Ошибка загрузки правил: {error}</div>
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
          placeholder="Поиск по названию"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          className="max-w-48"
        />
        {showOrgFilter && (
          <Input
            placeholder="Фильтр по организации"
            value={searchOrg}
            onChange={(e) => setSearchOrg(e.target.value)}
            className="max-w-56"
          />
        )}
        <Button variant="outline" onClick={fetchRules}>
          <RefreshCcw className="h-4 w-4" />
        </Button>
        <span className="ml-auto text-sm text-gray-400">
          {visibleRules.length}{" "}
          {plural(visibleRules.length, ["правило", "правила", "правил"])}
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
                Новое правило
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
              <TableHead>Название</TableHead>
              {showUserColumn && <TableHead>Создал</TableHead>}
              {showOrgColumn && <TableHead>Организация</TableHead>}
              <TableHead>Создано</TableHead>
              <TableHead>Обновлено</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRules.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="text-center text-gray-500"
                >
                  Правила не найдены
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
                    {new Date(r.createdAt).toLocaleDateString("ru-RU")}
                  </TableCell>
                  <TableCell>
                    {new Date(r.updatedAt).toLocaleDateString("ru-RU")}
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
