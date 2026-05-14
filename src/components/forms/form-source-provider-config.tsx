"use client"

// Per-provider provider-config form. Counterpart to <FormSourceCredentials>:
// same dispatch-by-provider pattern, but for non-secret connection
// routing (spaceId, driveId, …) so the dialog pre-fills with the
// existing values and the user can edit them.
//
// Used by both surfaces:
//   - Org-owner: <TableOrgSources> "Edit config" button
//   - Platform-admin: <FormAdminEditSource> Provider config section
//
// Adding a new provider with a config schema:
//   1. Declare the zod schema in `src/server/providers/handlers.ts`
//      (`<provider>ProviderConfigSchema`).
//   2. Add a branch below that renders the right inputs.
// The `null` case (provider has no providerConfigSchema — dropoff,
// whatsapp, aichat) renders an empty-state and the Save button stays
// disabled.

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import type { SourceProvider } from "@/db/schema"

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  sourceId: string
  sourceName: string
  provider: SourceProvider
  // The existing providerConfig value, pre-fills the form. Plain
  // object — non-secret so safe to read back.
  initialConfig: Record<string, unknown>
  // Where to PATCH { sourceId, providerConfig }. Differs between
  // /api/sources/org/config (owner) and /api/admin/sources/config (admin).
  endpoint: string
  onSaved: () => void
}

export function FormSourceProviderConfig({
  open,
  onOpenChange,
  sourceId,
  sourceName,
  provider,
  initialConfig,
  endpoint,
  onSaved,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit provider config — {sourceName}</DialogTitle>
          <DialogDescription>
            Non-secret connection routing. These fields identify which
            mailbox / space / drive this source pulls from. Secrets
            (API keys, service-account JSON) live on the Credentials
            form, not here.
          </DialogDescription>
        </DialogHeader>

        {provider === "nylas" && (
          <NylasFields
            sourceId={sourceId}
            endpoint={endpoint}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
        {provider === "gchat" && (
          <GchatFields
            sourceId={sourceId}
            initialConfig={initialConfig}
            endpoint={endpoint}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
        {provider === "gdrive" && (
          <GdriveFields
            sourceId={sourceId}
            initialConfig={initialConfig}
            endpoint={endpoint}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
        {(provider === "dropoff" ||
          provider === "whatsapp" ||
          provider === "aichat") && (
          <p className="text-sm text-muted-foreground py-4">
            This source provider has no configurable connection params.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

async function submitConfig(opts: {
  endpoint: string
  sourceId: string
  providerConfig: unknown
}): Promise<{ ok: true } | { ok: false; error: string; issues?: { path: string; message: string }[] }> {
  try {
    const res = await fetch(opts.endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: opts.sourceId,
        providerConfig: opts.providerConfig,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      return {
        ok: false,
        error: data.error ?? "Request failed",
        issues: data.issues,
      }
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    }
  }
}

function formatError(
  error: string,
  issues?: { path: string; message: string }[],
): string {
  if (issues && issues.length > 0) {
    return issues.map((i) => `${i.path}: ${i.message}`).join(" • ")
  }
  return error
}

// ── Per-provider field branches ──────────────────────────────────────

type FieldsProps = {
  sourceId: string
  endpoint: string
  onClose: () => void
  onSaved: () => void
  initialConfig: Record<string, unknown>
}

// Nylas has no configurable provider_config today — the grant id
// (the only mailbox identifier) lives in `credentials_ref` instead.
// Kept as an explicit branch (rather than a fallthrough) so the user
// gets a clear "nothing to configure here" message.
function NylasFields(props: Omit<FieldsProps, "initialConfig">) {
  return (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground">
        Nylas sources have no non-secret connection params — the
        per-mailbox grant id is configured under Credentials.
      </p>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={props.onClose}>
          Close
        </Button>
      </DialogFooter>
    </div>
  )
}

function GchatFields({
  sourceId,
  initialConfig,
  endpoint,
  onClose,
  onSaved,
}: FieldsProps) {
  // Initial value snapshot — the parent unmounts the dialog between
  // rows (the `{configForRow && (<… />)}` pattern in TableOrgSources
  // and the `isEdit && source && …` pattern in FormAdminEditSource),
  // so a fresh useState initializer per mount is enough to keep this
  // in sync with the row being edited.
  const [spaceId, setSpaceId] = useState(
    typeof initialConfig.spaceId === "string" ? initialConfig.spaceId : "",
  )
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!spaceId.trim()) {
      toast.error("Space ID is required")
      return
    }
    setBusy(true)
    const out = await submitConfig({
      endpoint,
      sourceId,
      providerConfig: { spaceId: spaceId.trim() },
    })
    setBusy(false)
    if (!out.ok) {
      toast.error(formatError(out.error, out.issues))
      return
    }
    toast.success("Provider config saved")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="gchat-space-id">Space ID</Label>
        <Input
          id="gchat-space-id"
          value={spaceId}
          onChange={(e) => setSpaceId(e.target.value)}
          placeholder="spaces/AAQA…"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Full Google Chat space resource path. Must start with
          <code className="ml-1 px-1 bg-muted rounded text-[11px]">spaces/</code>.
          Find it in the URL when viewing the space, or via the Chat API.
        </p>
      </div>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </div>
  )
}

function GdriveFields({
  sourceId,
  initialConfig,
  endpoint,
  onClose,
  onSaved,
}: FieldsProps) {
  // Same per-mount initialization rationale as GchatFields above.
  const [driveId, setDriveId] = useState(
    typeof initialConfig.driveId === "string" ? initialConfig.driveId : "",
  )
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!driveId.trim()) {
      toast.error("Drive ID is required")
      return
    }
    setBusy(true)
    const out = await submitConfig({
      endpoint,
      sourceId,
      providerConfig: { driveId: driveId.trim() },
    })
    setBusy(false)
    if (!out.ok) {
      toast.error(formatError(out.error, out.issues))
      return
    }
    toast.success("Provider config saved")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="gdrive-drive-id">Drive ID</Label>
        <Input
          id="gdrive-drive-id"
          value={driveId}
          onChange={(e) => setDriveId(e.target.value)}
          placeholder="0ADuGKT0uyTURUk9PVA"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Shared Drive identifier. Find it in the URL when viewing the
          drive in Google Drive (the segment after
          <code className="ml-1 px-1 bg-muted rounded text-[11px]">/drive/folders/</code>
          ).
        </p>
      </div>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </div>
  )
}
