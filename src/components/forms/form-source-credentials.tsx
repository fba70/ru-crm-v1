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
import { Checkbox } from "@/components/ui/checkbox"
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
          <DialogTitle>Настройка учётных данных — {sourceName}</DialogTitle>
          <DialogDescription>
            Учётные данные доступны только для записи. После сохранения их
            нельзя прочитать через интерфейс. Для замены вставьте новое значение
            и сохраните снова.
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
        {provider === "imap" && (
          <ImapFields
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
            Этот провайдер источника не требует учётных данных.
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
      toast.error("Укажите Grant ID")
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
    toast.success("Учётные данные сохранены")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="nylas-grant-id">Grant ID (это и есть учётные данные)</Label>
        <Input
          id="nylas-grant-id"
          value={grantId}
          onChange={(e) => setGrantId(e.target.value)}
          placeholder="напр. 30c70eb1-bbe2-4e0e-9cc7-..."
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Для источников «Почта» на базе Nylas <strong>Grant ID</strong> —
          единственные необходимые учётные данные: один Grant ID навсегда
          привязан к конкретному почтовому ящику в момент создания в Nylas.
          Чтобы получить его: откройте панель Nylas → Grants → подключите (или
          выберите) нужный почтовый ящик → скопируйте полученный UUID и вставьте
          сюда. Платформенные{" "}
          <code className="text-[10px]">NYLAS_API_KEY</code> /{" "}
          <code className="text-[10px]">NYLAS_API_URI</code> общие для всех
          источников в рамках одного приложения Nylas и здесь не настраиваются.
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

function ImapFields({ sourceId, endpoint, onClose, onSaved }: FieldsProps) {
  const [host, setHost] = useState("")
  const [port, setPort] = useState("993")
  const [secure, setSecure] = useState(true)
  const [user, setUser] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!host.trim()) {
      toast.error("Укажите хост IMAP-сервера")
      return
    }
    if (!user.trim()) {
      toast.error("Укажите имя пользователя")
      return
    }
    if (!password.trim()) {
      toast.error("Укажите пароль")
      return
    }
    const portNum = Number.parseInt(port, 10)
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      toast.error("Порт должен быть числом от 1 до 65535")
      return
    }
    setBusy(true)
    const out = await submitCredentials({
      endpoint,
      sourceId,
      credentials: {
        host: host.trim(),
        port: portNum,
        secure,
        user: user.trim(),
        password,
      },
    })
    setBusy(false)
    if (!out.ok) {
      toast.error(formatError(out.error, out.issues))
      return
    }
    toast.success("Учётные данные сохранены")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="imap-host">Хост IMAP-сервера</Label>
        <Input
          id="imap-host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="напр. imap.gmail.com"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="imap-port">Порт</Label>
          <Input
            id="imap-port"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="993"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label>Шифрование</Label>
          <label className="flex items-center gap-2 h-9 cursor-pointer text-sm">
            <Checkbox
              checked={secure}
              onCheckedChange={(v) => setSecure(v === true)}
            />
            <span>Неявный TLS (порт 993)</span>
          </label>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Отметьте «Неявный TLS» для подключения по протоколу SSL/TLS (обычно
        порт 993). Снимите отметку для STARTTLS (обычно порт 143) — так
        подключаются некоторые сервисы, отличные от Gmail.
      </p>
      <div className="space-y-2">
        <Label htmlFor="imap-user">Пользователь</Label>
        <Input
          id="imap-user"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="напр. sales@yourdomain.com"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="imap-password">Пароль</Label>
        <Input
          id="imap-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="пароль или пароль приложения"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Пароль почтового ящика. Для Gmail и многих провайдеров с двухфакторной
          аутентификацией нужен <strong>пароль приложения</strong>, а не обычный
          пароль от аккаунта. Учётные данные хранятся в зашифрованном виде и
          используются только для чтения почты.
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

function GchatFields({ sourceId, endpoint, onClose, onSaved }: FieldsProps) {
  const [serviceAccountJson, setServiceAccountJson] = useState("")
  const [impersonateUser, setImpersonateUser] = useState("")
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!serviceAccountJson.trim()) {
      toast.error("Укажите JSON сервисного аккаунта")
      return
    }
    if (!impersonateUser.trim()) {
      toast.error("Укажите пользователя для имперсонации")
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
    toast.success("Учётные данные сохранены")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="gchat-sa">JSON сервисного аккаунта</Label>
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
          Вставьте полное содержимое JSON-файла. Должно содержать client_email и
          private_key. Для этого сервисного аккаунта в Google Workspace Admin
          должно быть включено делегирование на уровне домена.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="gchat-impersonate">Пользователь для имперсонации</Label>
        <Input
          id="gchat-impersonate"
          type="email"
          value={impersonateUser}
          onChange={(e) => setImpersonateUser(e.target.value)}
          placeholder="hello@yourdomain.com"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Пользователь Workspace для имперсонации через DWD. Требуется для
          скачивания вложений из Chat (медиа-эндпоинт принимает только
          пользовательские scope).
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

function GdriveFields({ sourceId, endpoint, onClose, onSaved }: FieldsProps) {
  const [serviceAccountJson, setServiceAccountJson] = useState("")
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!serviceAccountJson.trim()) {
      toast.error("Укажите JSON сервисного аккаунта")
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
    toast.success("Учётные данные сохранены")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="gdrive-sa">JSON сервисного аккаунта</Label>
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
          Вставьте полное содержимое JSON-файла. У сервисного аккаунта должен
          быть доступ на чтение к общим дискам, настроенным для этого источника.
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

function TelegramFields({ sourceId, endpoint, onClose, onSaved }: FieldsProps) {
  const [botToken, setBotToken] = useState("")
  const [webhookSecret, setWebhookSecret] = useState("")
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!botToken.trim()) {
      toast.error("Укажите токен бота")
      return
    }
    if (!webhookSecret.trim()) {
      toast.error("Укажите секрет веб-хука")
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
    toast.success("Учётные данные сохранены — веб-хук зарегистрирован в Telegram")
    onSaved()
    onClose()
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="tg-bot-token">Токен бота</Label>
        <Input
          id="tg-bot-token"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder="123456789:AAH..."
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Токен, который <strong>@BotFather</strong> выдал при создании бота
          (<code className="text-[10px]">/newbot</code>). Он даёт полный контроль
          над ботом — храните его как секрет. Каждая организация использует
          своего бота, поэтому вставьте токен бота <em>этой</em> организации.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="tg-webhook-secret">Секрет веб-хука</Label>
        <Input
          id="tg-webhook-secret"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder="случайная строка с высокой энтропией"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Случайная строка, которую генерируете <em>вы</em> (напр.{" "}
          <code className="text-[10px]">openssl rand -hex 32</code>). Telegram
          возвращает её при каждой доставке, чтобы можно было отклонять подделки.
          Сохранение здесь автоматически регистрирует веб-хук бота в Telegram
          (допустимы только символы A–Z, a–z, 0–9,{" "}
          <code className="text-[10px]">_</code> и{" "}
          <code className="text-[10px]">-</code>).
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

function formatError(
  error: string,
  issues?: { path: string; message: string }[],
): string {
  if (issues && issues.length > 0) {
    return issues.map((i) => `${i.path}: ${i.message}`).join(" • ")
  }
  return error
}
