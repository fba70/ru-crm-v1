"use client"

// Per-provider credentials form. Used by both surfaces:
//   - Org-owner: <TableOrgSources> "Configure" button
//   - Platform-admin: <FormAdminEditSource> credentials section
//
// Behaviour:
//   - Write-only. The dialog never displays a previously saved value;
//     the row already shows "Configured ✓" / "Not configured" via the
//     `credentialsConfigured` boolean on the list response. Re-saving
//     overwrites silently.
//   - Per-provider field set, dispatched by `provider`. Adding a new
//     provider with credentials means adding a new branch + a zod
//     schema in `src/server/providers/handlers.ts` — both surfaces
//     pick it up automatically.
//   - Server-side validation is the source of truth (zod schemas
//     declared in handlers.ts). Client-side just enforces non-empty
//     so the submit button gates obvious typos.
//   - On submit, calls the supplied `endpoint` with `{ sourceId,
//     credentials }`. The endpoint is responsible for encryption +
//     persistence; this component never touches plaintext after
//     handing it off.

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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import type { SourceProvider } from "@/db/schema"

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  sourceId: string
  sourceName: string
  provider: SourceProvider
  // Where to PUT { sourceId, credentials }. Differs between
  // /api/sources/org/credentials (owner) and /api/admin/sources/credentials.
  endpoint: string
  onSaved: () => void
}

export function FormSourceCredentials({
  open,
  onOpenChange,
  sourceId,
  sourceName,
  provider,
  endpoint,
  onSaved,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configure credentials — {sourceName}</DialogTitle>
          <DialogDescription>
            Credentials are write-only. After saving, the existing values
            cannot be read back through the UI. To rotate, paste a fresh
            value and save again.
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
            endpoint={endpoint}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
        {provider === "gdrive" && (
          <GdriveFields
            sourceId={sourceId}
            endpoint={endpoint}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
        {provider === "telegram" && (
          <TelegramFields
            sourceId={sourceId}
            endpoint={endpoint}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
        {(provider === "dropoff" ||
          provider === "whatsapp" ||
          provider === "aichat") && (
          <p className="text-sm text-muted-foreground py-4">
            This source provider does not require credentials.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Shared submit helper — POST the validated payload, surface zod issues
// as inline form errors via toast, refresh the parent on success.
async function submitCredentials(opts: {
  endpoint: string
  sourceId: string
  credentials: unknown
}): Promise<{ ok: true } | { ok: false; error: string; issues?: { path: string; message: string }[] }> {
  try {
    const res = await fetch(opts.endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: opts.sourceId,
        credentials: opts.credentials,
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

type FieldsProps = {
  sourceId: string
  endpoint: string
  onClose: () => void
  onSaved: () => void
}

function NylasFields({ sourceId, endpoint, onClose, onSaved }: FieldsProps) {
  const [grantId, setGrantId] = useState("")
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!grantId.trim()) {
      toast.error("Grant ID is required")
      return
    }
    setBusy(true)
    const out = await submitCredentials({
      endpoint,
      sourceId,
      credentials: { grantId: grantId.trim() },
    })
    setBusy(false)
    if (!out.ok) {
      toast.error(formatError(out.error, out.issues))
      return
    }
    toast.success("Credentials saved")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="nylas-grant-id">Grant ID (this is the credential)</Label>
        <Input
          id="nylas-grant-id"
          value={grantId}
          onChange={(e) => setGrantId(e.target.value)}
          placeholder="e.g. 30c70eb1-bbe2-4e0e-9cc7-..."
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          For Nylas-backed Email sources, the <strong>Grant ID</strong> is
          the only credential required — one Grant ID is permanently bound
          to one specific mailbox at the time it&apos;s created in Nylas.
          To get one: open the Nylas dashboard → Grants → connect (or pick)
          the mailbox you want this source to read → copy the resulting
          UUID and paste it here. The platform-level{" "}
          <code className="text-[10px]">NYLAS_API_KEY</code> /{" "}
          <code className="text-[10px]">NYLAS_API_URI</code> are shared
          across every source under the same Nylas Application and are not
          configured here.
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

function GchatFields({ sourceId, endpoint, onClose, onSaved }: FieldsProps) {
  const [serviceAccountJson, setServiceAccountJson] = useState("")
  const [impersonateUser, setImpersonateUser] = useState("")
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!serviceAccountJson.trim()) {
      toast.error("Service account JSON is required")
      return
    }
    if (!impersonateUser.trim()) {
      toast.error("Impersonate user is required")
      return
    }
    setBusy(true)
    const out = await submitCredentials({
      endpoint,
      sourceId,
      credentials: {
        serviceAccountJson: serviceAccountJson.trim(),
        impersonateUser: impersonateUser.trim(),
      },
    })
    setBusy(false)
    if (!out.ok) {
      toast.error(formatError(out.error, out.issues))
      return
    }
    toast.success("Credentials saved")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="gchat-sa">Service account JSON</Label>
        <Textarea
          id="gchat-sa"
          value={serviceAccountJson}
          onChange={(e) => setServiceAccountJson(e.target.value)}
          placeholder='{"type":"service_account","project_id":"...","client_email":"...@...iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\\n..."}'
          rows={8}
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Paste the full JSON file content. Must contain client_email and
          private_key. Domain-wide delegation must be enabled for this
          service account in Google Workspace Admin.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="gchat-impersonate">Impersonate user</Label>
        <Input
          id="gchat-impersonate"
          type="email"
          value={impersonateUser}
          onChange={(e) => setImpersonateUser(e.target.value)}
          placeholder="hello@yourdomain.com"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Workspace user to impersonate via DWD. Required for Chat
          attachment download (the media endpoint only accepts user-auth
          scopes).
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

function GdriveFields({ sourceId, endpoint, onClose, onSaved }: FieldsProps) {
  const [serviceAccountJson, setServiceAccountJson] = useState("")
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!serviceAccountJson.trim()) {
      toast.error("Service account JSON is required")
      return
    }
    setBusy(true)
    const out = await submitCredentials({
      endpoint,
      sourceId,
      credentials: { serviceAccountJson: serviceAccountJson.trim() },
    })
    setBusy(false)
    if (!out.ok) {
      toast.error(formatError(out.error, out.issues))
      return
    }
    toast.success("Credentials saved")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="gdrive-sa">Service account JSON</Label>
        <Textarea
          id="gdrive-sa"
          value={serviceAccountJson}
          onChange={(e) => setServiceAccountJson(e.target.value)}
          placeholder='{"type":"service_account","project_id":"...","client_email":"...@...iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\\n..."}'
          rows={8}
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Paste the full JSON file content. The service account must
          have read access to the shared Drive(s) configured for this
          source.
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

function TelegramFields({ sourceId, endpoint, onClose, onSaved }: FieldsProps) {
  const [botToken, setBotToken] = useState("")
  const [webhookSecret, setWebhookSecret] = useState("")
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!botToken.trim()) {
      toast.error("Bot token is required")
      return
    }
    if (!webhookSecret.trim()) {
      toast.error("Webhook secret is required")
      return
    }
    setBusy(true)
    const out = await submitCredentials({
      endpoint,
      sourceId,
      credentials: {
        botToken: botToken.trim(),
        webhookSecret: webhookSecret.trim(),
      },
    })
    setBusy(false)
    if (!out.ok) {
      toast.error(formatError(out.error, out.issues))
      return
    }
    toast.success("Credentials saved — webhook registered with Telegram")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="tg-bot-token">Bot token</Label>
        <Input
          id="tg-bot-token"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder="123456789:AAH..."
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          The token <strong>@BotFather</strong> gave you when you created the
          bot (<code className="text-[10px]">/newbot</code>). It grants full
          control of the bot — treat it as a secret. Each organization runs
          its own bot, so paste the token for <em>this</em> org&apos;s bot.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="tg-webhook-secret">Webhook secret</Label>
        <Input
          id="tg-webhook-secret"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder="a high-entropy random string"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          A random string <em>you</em> generate (e.g.{" "}
          <code className="text-[10px]">openssl rand -hex 32</code>). Telegram
          echoes it back on every delivery so we can reject forgeries. Saving
          here automatically registers the bot&apos;s webhook with Telegram
          (only chars A–Z, a–z, 0–9, <code className="text-[10px]">_</code>{" "}
          and <code className="text-[10px]">-</code> are allowed).
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

function formatError(
  error: string,
  issues?: { path: string; message: string }[],
): string {
  if (issues && issues.length > 0) {
    return issues.map((i) => `${i.path}: ${i.message}`).join(" • ")
  }
  return error
}
