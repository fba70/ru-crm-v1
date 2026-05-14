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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader, RefreshCcw, ShieldCheck } from "lucide-react"
import FormAdminEditSource from "@/components/forms/form-admin-edit-source"
import type { AdminSource } from "@/app/api/admin/sources/route"
import { PROVIDER_LIST, getProvider } from "@/lib/sources/providers"
import type { SourceProvider } from "@/db/schema"

const ITEMS_PER_PAGE = 10
const ALL_PROVIDERS = "__all__"

// Single-line provider cell with the registry icon + label. Falls
// through to a synthetic entry for unknown providers (see
// `getProvider`) so the row still renders during a brief deploy
// window where the enum is ahead of the code.
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

export function TableAdminSources() {
  const [sources, setSources] = useState<AdminSource[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [searchName, setSearchName] = useState("")
  const [provider, setProvider] = useState<string>(ALL_PROVIDERS)
  const [showInactive, setShowInactive] = useState(false)

  const fetchSources = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(ITEMS_PER_PAGE),
        offset: String((page - 1) * ITEMS_PER_PAGE),
      })
      if (searchName) params.set("searchName", searchName)
      if (provider !== ALL_PROVIDERS) params.set("provider", provider)
      if (showInactive) params.set("showInactive", "1")

      const res = await fetch(`/api/admin/sources?${params}`)
      if (!res.ok) throw new Error("Failed to fetch sources")
      const data = await res.json()
      setSources(data.sources ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [page, searchName, provider, showInactive])

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  if (error) {
    return (
      <div className="text-red-500 text-lg">
        Error loading sources: {error}
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
        <Select
          value={provider}
          onValueChange={(v) => {
            setProvider(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROVIDERS}>All providers</SelectItem>
            {PROVIDER_LIST.map((p) => (
              <SelectItem key={p.provider} value={p.provider}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
          <Checkbox
            checked={showInactive}
            onCheckedChange={(v) => {
              setShowInactive(v === true)
              setPage(1)
            }}
          />
          Show inactive
        </label>
        <Button variant="outline" onClick={fetchSources}>
          <RefreshCcw className="h-4 w-4" />
        </Button>
        <span className="ml-auto text-sm text-gray-400">
          {total} source{total !== 1 && "s"} total
        </span>
        <FormAdminEditSource onSuccess={fetchSources} />
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
                <TableHead>Type</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>System</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Auto Parse</TableHead>
                <TableHead className="w-12">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray-500">
                    No sources found
                  </TableCell>
                </TableRow>
              ) : (
                sources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm capitalize">
                      {s.type}
                    </TableCell>
                    <TableCell className="text-sm">
                      <ProviderCell provider={s.provider} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.isSystem ? (
                        <span className="text-muted-foreground italic">
                          —
                        </span>
                      ) : (
                        s.ownerOrganizationName ?? (
                          <span className="text-muted-foreground italic">
                            unknown
                          </span>
                        )
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      {s.isSystem ? (
                        <Badge
                          variant="secondary"
                          className="gap-1 text-xs"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          System
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          s.status === "active" ? "default" : "outline"
                        }
                        className="text-xs capitalize"
                      >
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          s.automatedParsingIsAllowed ? "default" : "outline"
                        }
                        className="text-xs"
                      >
                        {s.automatedParsingIsAllowed ? "On" : "Off"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <FormAdminEditSource
                        source={s}
                        onSuccess={fetchSources}
                      />
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
