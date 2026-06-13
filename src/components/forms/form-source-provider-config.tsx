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
          <DialogTitle>Настройки провайдера — {sourceName}</DialogTitle>
          <DialogDescription>
            Несекретные параметры подключения. Эти поля указывают, из какого
            ящика / пространства / диска источник читает данные. Секреты (API-
            ключи, JSON сервисного аккаунта) задаются на форме «Учётные
            данные», а не здесь.
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
        {provider === "telegram" && (
          <TelegramFields
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
            У этого провайдера источника нет настраиваемых параметров
            подключения.
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
        error: data.error ?? "Запрос не выполнен",
        issues: data.issues,
      }
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Ошибка сети",
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
        У источников Nylas нет несекретных параметров подключения — grant id
        для каждого почтового ящика настраивается в разделе «Учётные данные».
      </p>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={props.onClose}>
          Закрыть
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
      toast.error("Укажите Space ID")
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
    toast.success("Настройки провайдера сохранены")
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
          Полный путь ресурса пространства Google Chat. Должен начинаться с
          <code className="ml-1 px-1 bg-muted rounded text-[11px]">spaces/</code>.
          Найдите его в URL при просмотре пространства или через Chat API.
        </p>
      </div>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
          Отмена
        </Button>
        <Button type="button" onClick={handleSave} disabled={busy}>
          {busy ? "Сохранение…" : "Сохранить"}
        </Button>
      </DialogFooter>
    </div>
  )
}

// Telegram: the only non-secret config is the bot's @username (no leading
// @), used to detect @-mentions in groups (Phase 3) and to build deep
// links. Optional — DM ingestion (Phase 1) doesn't need it, so an empty
// save is allowed (clears the field). The bot token + webhook secret live
// on the Credentials form, not here.
function TelegramFields({
  sourceId,
  initialConfig,
  endpoint,
  onClose,
  onSaved,
}: FieldsProps) {
  const [botUsername, setBotUsername] = useState(
    typeof initialConfig.botUsername === "string"
      ? initialConfig.botUsername
      : "",
  )
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    setBusy(true)
    const out = await submitConfig({
      endpoint,
      sourceId,
      providerConfig: { botUsername: botUsername.trim().replace(/^@/, "") },
    })
    setBusy(false)
    if (!out.ok) {
      toast.error(formatError(out.error, out.issues))
      return
    }
    toast.success("Настройки провайдера сохранены")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="telegram-bot-username">Имя бота (необязательно)</Label>
        <Input
          id="telegram-bot-username"
          value={botUsername}
          onChange={(e) => setBotUsername(e.target.value)}
          placeholder="truffalo_ingest_bot"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          @username бота без ведущего @. Используется для распознавания
          @-упоминаний в группах и построения deep-ссылок. Не требуется для
          приёма личных сообщений. Токен бота и секрет веб-хука задаются на
          форме «Учётные данные».
        </p>
      </div>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
          Отмена
        </Button>
        <Button type="button" onClick={handleSave} disabled={busy}>
          {busy ? "Сохранение…" : "Сохранить"}
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
      toast.error("Укажите Drive ID")
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
    toast.success("Настройки провайдера сохранены")
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
          Идентификатор общего диска. Найдите его в URL при просмотре диска в
          Google Drive (сегмент после
          <code className="ml-1 px-1 bg-muted rounded text-[11px]">/drive/folders/</code>
          ).
        </p>
      </div>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
          Отмена
        </Button>
        <Button type="button" onClick={handleSave} disabled={busy}>
          {busy ? "Сохранение…" : "Сохранить"}
        </Button>
      </DialogFooter>
    </div>
  )
}
