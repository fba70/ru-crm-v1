"use client"

import { useCallback, useEffect, useState } from "react"
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
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader, RefreshCcw } from "lucide-react"
import { toast } from "sonner"
import { getProvider } from "@/lib/sources/providers"
import { FormAdminEditTemplate } from "@/components/forms/form-admin-edit-template"
import type { TemplateRow } from "@/server/templates"
import type { SourceProvider } from "@/db/schema"

const ITEMS_PER_PAGE = 10

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

// Display labels — DB enum keys stay English.
const TYPE_LABEL: Record<string, string> = {
  external: "Внешний",
  internal: "Внутренний",
}
const STATUS_LABEL: Record<string, string> = {
  active: "Активен",
  inactive: "Неактивен",
}

function ProviderCell({ provider }: { provider: SourceProvider | string }) {
  const meta = getProvider(provider)
  const Icon = meta.icon
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      {meta.label}
    </span>
  )
}

// Admin-only template dictionary management.
// Lists every template (active + inactive when "Show inactive" is on),
// supports inline create/edit via the schema-driven form, and surfaces
// the two policy flags `is_default` (auto-instantiate on org create)
// and `is_visible_to_orgs` (show in owner picker) as boolean badges.
//
// Hard delete is intentionally absent — templates soft-delete via
// status='inactive' through the edit form.
export function TableAdminTemplates() {
  const [rows, setRows] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [showInactive, setShowInactive] = useState(false)
  const [page, setPage] = useState(1)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (showInactive) params.set("showInactive", "1")
      const res = await fetch(`/api/admin/templates?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось загрузить шаблоны")
      setRows(data.templates ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка")
    } finally {
      setLoading(false)
    }
  }, [showInactive])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  // Filter client-side — small list, no server-side search needed.
  const filtered = search.trim()
    ? rows.filter((r) =>
        r.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : rows
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const pageRows = filtered.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  // Reset to page 1 whenever filters change.
  useEffect(() => {
    setPage(1)
  }, [search, showInactive])

  if (error) {
    return <div className="text-sm text-destructive py-6">{error}</div>
  }

  return (
    <>
      <div className="flex flex-row flex-wrap items-center gap-2 mb-4">
        <Input
          placeholder="Поиск по названию"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-48"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
          <Checkbox
            checked={showInactive}
            onCheckedChange={(v) => setShowInactive(v === true)}
          />
          Показывать неактивные
        </label>
        <Button variant="outline" onClick={fetchRows}>
          <RefreshCcw className="h-4 w-4" />
        </Button>
        <span className="ml-auto text-sm text-gray-400">
          {filtered.length} {plural(filtered.length, ["шаблон", "шаблона", "шаблонов"])}
        </span>
        <FormAdminEditTemplate onSuccess={fetchRows} />
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
                <TableHead>Провайдер</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>По умолчанию</TableHead>
                <TableHead>Видим организациям</TableHead>
                <TableHead>Авторазбор</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="w-12">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray-500 py-6">
                    Шаблоны не найдены.
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm">
                      <ProviderCell provider={t.provider} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {TYPE_LABEL[t.type] ?? t.type}
                    </TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={t.isDefault ? "default" : "outline"}
                        className="text-xs"
                      >
                        {t.isDefault ? "Да" : "Нет"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={t.isVisibleToOrgs ? "default" : "outline"}
                        className="text-xs"
                      >
                        {t.isVisibleToOrgs ? "Да" : "Нет"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.defaultAutomatedParsingIsAllowed ? "default" : "outline"
                        }
                        className="text-xs"
                      >
                        {t.defaultAutomatedParsingIsAllowed ? "Вкл" : "Выкл"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={t.status === "active" ? "default" : "outline"}
                        className="text-xs"
                      >
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <FormAdminEditTemplate template={t} onSuccess={fetchRows} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-end gap-4 mt-4">
            <span className="text-sm text-gray-400">
              стр. {page} из {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Назад
              </Button>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Вперёд
              </Button>
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="text-sm text-destructive py-2">{error}</div>
      )}
      {error === null && rows.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground mt-4">
          Шаблонов пока нет. Выполните <code>pnpm tsx scripts/seed-templates.ts --apply</code>,{" "}
          чтобы создать 7 стандартных, или нажмите «Добавить» выше.
        </p>
      )}

      {/* Re-using the toaster — toasts are already mounted in the
          shell. Ensure any error path surfaces via toast. */}
      {(() => {
        if (error) toast.error(error)
        return null
      })()}
    </>
  )
}
