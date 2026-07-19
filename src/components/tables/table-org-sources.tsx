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
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Loader, RefreshCcw, KeyRound, Settings, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { SourceProvider, SourceStatus } from "@/db/schema"
import { getProvider } from "@/lib/sources/providers"
import { FormSourceCredentials } from "@/components/forms/form-source-credentials"
import { FormSourceProviderConfig } from "@/components/forms/form-source-provider-config"
import { FormSourceIdentity } from "@/components/forms/form-source-identity"
import { AddSourceDialog } from "@/components/blocks/add-source-dialog"

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

// Display labels for the source status badge (DB enum stays English).
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

// Credentials cell: badge showing configured-or-not state + Configure
// button that opens the per-provider schema-driven dialog. Providers
// that don't take credentials (dropoff/whatsapp/aichat) render a dash
// — no Configure affordance is meaningful.
function CredentialsCell({
  row,
  onConfigure,
}: {
  row: Row
  onConfigure: (row: Row) => void
}) {
  const meta = getProvider(row.provider)
  const needsCreds =
    row.provider === "nylas" ||
    row.provider === "imap" ||
    row.provider === "gchat" ||
    row.provider === "gdrive" ||
    row.provider === "telegram"
  if (!needsCreds) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  void meta
  return (
    <div className="inline-flex items-center gap-2">
      <Badge
        variant={row.credentialsConfigured ? "default" : "outline"}
        className="text-xs"
      >
        {row.credentialsConfigured ? "Настроено" : "Не настроено"}
      </Badge>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2"
        onClick={() => onConfigure(row)}
      >
        <KeyRound className="h-3.5 w-3.5 mr-1" />
        {row.credentialsConfigured ? "Заменить" : "Настроить"}
      </Button>
    </div>
  )
}

// Provider-config cell: read-write Edit button that opens the
// schema-driven dialog pre-filled with the existing values. Renders
// for providers that have a non-null providerConfigSchema; others get
// a dash (consistent with credentials).
function ConfigCell({
  row,
  onEdit,
}: {
  row: Row
  onEdit: (row: Row) => void
}) {
  // Same predicate as CredentialsCell — providers with a non-null
  // providerConfigSchema. Nylas's schema is empty (z.object({})) but we
  // still render the Edit button so the user can see the "nothing to
  // configure" message inside the dialog. Telegram exposes an optional
  // botUsername.
  const hasConfigurable =
    row.provider === "nylas" ||
    row.provider === "imap" ||
    row.provider === "gchat" ||
    row.provider === "gdrive" ||
    row.provider === "telegram"
  if (!hasConfigurable) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2"
      onClick={() => onEdit(row)}
    >
      <Settings className="h-3.5 w-3.5 mr-1" />
      Изменить
    </Button>
  )
}

// Override the default switch palette: the base component paints the
// checked rail with `bg-primary` (orange in this theme), but here the
// orange signal is owned by the adjacent Badge — the rail itself stays
// neutral so the row reads as "neutral toggle + colored label". Border
// + dark thumb keep the checked state visually distinct from unchecked
// even with the rail muted.
const NEUTRAL_SWITCH =
  "data-[state=checked]:bg-background data-[state=checked]:border-input " +
  "[&>[data-slot=switch-thumb]]:data-[state=checked]:bg-foreground " +
  "dark:data-[state=checked]:bg-input/40 " +
  "dark:[&>[data-slot=switch-thumb]]:data-[state=checked]:bg-foreground"

type Row = {
  id: string
  provider: SourceProvider
  name: string
  description: string | null
  status: SourceStatus
  automatedParsingIsAllowed: boolean
  lastSyncedAt: string | null
  // Boolean projection of `source.credentials_ref`. Plaintext is never
  // returned from the server — owners see "Configured ✓" or "Not
  // configured" and re-paste to update.
  credentialsConfigured: boolean
  // Non-secret connection routing (spaceId, driveId, …). Used to
  // pre-fill the provider-config dialog. Safe to send to the client —
  // anything sensitive lives in `credentials_ref` instead.
  providerConfig: Record<string, unknown>
  // FK back to the template this row came from. Used by the "Add
  // source" dialog to count existing instances per template and warn
  // the owner that adding another creates a parallel instance.
  templateId: string | null
}

// Owner-only management surface for the caller's org sources. Inline
// knobs — Auto Parse + Status — flipped via PATCH against
// /api/sources/org. Credentials configured via PUT against
// /api/sources/org/credentials through the schema-driven dialog.
// Heavier structural edits (provider, system flag, providerConfig)
// still live in the platform-admin Settings page.
export function TableOrgSources() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [credsForRow, setCredsForRow] = useState<Row | null>(null)
  const [configForRow, setConfigForRow] = useState<Row | null>(null)
  const [identityForRow, setIdentityForRow] = useState<Row | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/sources/org")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось загрузить источники")
      setRows(data.sources ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  async function patchSource(id: string, patch: Partial<Row>) {
    setPendingId(id)
    try {
      const res = await fetch("/api/sources/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: id, ...patch }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось обновить")
      // Optimistic update: replace just the matching row in place so the
      // toggle doesn't visibly bounce while the GET re-runs.
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      )
      toast.success("Обновлено")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Неизвестная ошибка"
      toast.error(msg)
      // Re-fetch on failure so the UI reflects server truth instead of
      // the optimistic guess.
      fetchRows()
    } finally {
      setPendingId(null)
    }
  }

  if (error) {
    return <div className="text-sm text-destructive py-6">{error}</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {loading
            ? "Загрузка…"
            : `${rows.length} ${plural(rows.length, ["источник", "источника", "источников"])}`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchRows}
            disabled={loading}
          >
            <RefreshCcw className="h-3.5 w-3.5 mr-1" />
            Обновить
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Добавить источник
          </Button>
        </div>
      </div>

      {credsForRow && (
        <FormSourceCredentials
          open={credsForRow !== null}
          onOpenChange={(o) => {
            if (!o) setCredsForRow(null)
          }}
          sourceId={credsForRow.id}
          sourceName={credsForRow.name}
          provider={credsForRow.provider}
          endpoint="/api/sources/org/credentials"
          onSaved={() => {
            setCredsForRow(null)
            fetchRows()
          }}
        />
      )}

      {configForRow && (
        <FormSourceProviderConfig
          open={configForRow !== null}
          onOpenChange={(o) => {
            if (!o) setConfigForRow(null)
          }}
          sourceId={configForRow.id}
          sourceName={configForRow.name}
          provider={configForRow.provider}
          initialConfig={configForRow.providerConfig}
          endpoint="/api/sources/org/config"
          onSaved={() => {
            setConfigForRow(null)
            fetchRows()
          }}
        />
      )}

      {identityForRow && (
        <FormSourceIdentity
          open={identityForRow !== null}
          onOpenChange={(o) => {
            if (!o) setIdentityForRow(null)
          }}
          sourceId={identityForRow.id}
          initialName={identityForRow.name}
          initialDescription={identityForRow.description}
          onSaved={() => {
            setIdentityForRow(null)
            fetchRows()
          }}
        />
      )}

      <AddSourceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={fetchRows}
        existingTemplateIds={rows
          .map((r) => r.templateId)
          .filter((id): id is string => id !== null)}
      />

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Провайдер</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Авторазбор</TableHead>
              <TableHead>Учётные данные</TableHead>
              <TableHead>Настройки</TableHead>
              <TableHead>Синхронизация</TableHead>
              <TableHead className="w-12">Изм.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                    <Loader className="h-4 w-4 animate-spin mr-2" />
                    Загрузка источников…
                  </div>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                  Для вашей организации ещё нет источников.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm">
                    <ProviderCell provider={s.provider} />
                  </TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <div className="inline-flex items-center gap-2">
                      <Switch
                        checked={s.status === "active"}
                        disabled={pendingId === s.id}
                        onCheckedChange={(v) =>
                          patchSource(s.id, {
                            status: v ? "active" : "inactive",
                          })
                        }
                        aria-label="Переключить активность источника"
                        className={NEUTRAL_SWITCH}
                      />
                      <Badge
                        variant={s.status === "active" ? "default" : "outline"}
                        className="text-xs"
                      >
                        {STATUS_LABEL[s.status] ?? s.status}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="inline-flex items-center gap-2">
                      <Switch
                        checked={s.automatedParsingIsAllowed}
                        disabled={pendingId === s.id}
                        onCheckedChange={(v) =>
                          patchSource(s.id, { automatedParsingIsAllowed: v })
                        }
                        aria-label="Переключить авторазбор"
                        className={NEUTRAL_SWITCH}
                      />
                      <Badge
                        variant={
                          s.automatedParsingIsAllowed ? "default" : "outline"
                        }
                        className="text-xs"
                      >
                        {s.automatedParsingIsAllowed ? "Вкл" : "Выкл"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <CredentialsCell row={s} onConfigure={setCredsForRow} />
                  </TableCell>
                  <TableCell>
                    <ConfigCell row={s} onEdit={setConfigForRow} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.lastSyncedAt
                      ? new Date(s.lastSyncedAt).toLocaleString("ru-RU")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setIdentityForRow(s)}
                      aria-label="Изменить название и описание"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
