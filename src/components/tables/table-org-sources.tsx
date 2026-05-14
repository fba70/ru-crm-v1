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
    row.provider === "gchat" ||
    row.provider === "gdrive"
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
        {row.credentialsConfigured ? "Configured" : "Not configured"}
      </Badge>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2"
        onClick={() => onConfigure(row)}
      >
        <KeyRound className="h-3.5 w-3.5 mr-1" />
        {row.credentialsConfigured ? "Replace" : "Configure"}
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
  // Same predicate as CredentialsCell — we only ship non-null
  // providerConfigSchema for these three. Nylas's schema is empty
  // (z.object({})) but we still render the Edit button so the user can
  // see the "nothing to configure" message inside the dialog.
  const hasConfigurable =
    row.provider === "nylas" ||
    row.provider === "gchat" ||
    row.provider === "gdrive"
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
      Edit
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
      if (!res.ok) throw new Error(data.error || "Failed to load sources")
      setRows(data.sources ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
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
      if (!res.ok) throw new Error(data.error || "Update failed")
      // Optimistic update: replace just the matching row in place so the
      // toggle doesn't visibly bounce while the GET re-runs.
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      )
      toast.success("Updated")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
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
            ? "Loading…"
            : `${rows.length} source${rows.length === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchRows}
            disabled={loading}
          >
            <RefreshCcw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add source
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
              <TableHead>Provider</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Auto Parse</TableHead>
              <TableHead>Credentials</TableHead>
              <TableHead>Config</TableHead>
              <TableHead>Last Synced</TableHead>
              <TableHead className="w-12">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                    <Loader className="h-4 w-4 animate-spin mr-2" />
                    Loading sources…
                  </div>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                  No sources for your organization yet.
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
                        aria-label="Toggle source active"
                        className={NEUTRAL_SWITCH}
                      />
                      <Badge
                        variant={s.status === "active" ? "default" : "outline"}
                        className="text-xs capitalize"
                      >
                        {s.status}
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
                        aria-label="Toggle automated parsing"
                        className={NEUTRAL_SWITCH}
                      />
                      <Badge
                        variant={
                          s.automatedParsingIsAllowed ? "default" : "outline"
                        }
                        className="text-xs"
                      >
                        {s.automatedParsingIsAllowed ? "On" : "Off"}
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
                      ? new Date(s.lastSyncedAt).toLocaleString()
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setIdentityForRow(s)}
                      aria-label="Edit identity"
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
