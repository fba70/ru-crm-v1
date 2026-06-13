"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FolderUp, Loader, Upload } from "lucide-react"
import { toast } from "sonner"
import type { SystemSource } from "@/server/sources"
import { getProvider, PROVIDER_LIST } from "@/lib/sources/providers"

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

// Action bar at the top of the Sources page.
//
// The per-source Sync row covers every provider whose registry entry has
// `supportsRemoteSync: true` (nylas / gchat / gdrive today). Providers
// that ingest user-uploaded bytes — `supportsArchiveUpload` (whatsapp)
// and `supportsDropoffUpload` (dropoff) — are rendered as dedicated
// buttons on the right that open their own dialogs. AI Chat sessions
// are saved from the dashboard chat header, so they're excluded too.
//
// All filtering goes through `getProvider().capabilities.*` rather than
// hardcoded provider literals, so adding a new provider in the registry
// flips the right buttons on/off automatically.
export function SyncActionBar({
  sources,
  onSynced,
  onOpenDropoffUpload,
  onOpenWhatsAppUpload,
}: {
  sources: SystemSource[]
  onSynced: () => void
  onOpenDropoffUpload: () => void
  onOpenWhatsAppUpload: () => void
}) {
  // Show the WhatsApp Archive button only when the org has at least
  // one source matching the archive-upload capability seeded — otherwise
  // the upload route would 404.
  const archiveProviders = new Set(
    PROVIDER_LIST.filter((p) => p.capabilities.supportsArchiveUpload).map(
      (p) => p.provider,
    ),
  )
  const hasArchiveSource = sources.some((s) => archiveProviders.has(s.provider))

  return (
    <div className="flex flex-wrap items-center gap-2 justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {sources
          .filter((s) => getProvider(s.provider).capabilities.supportsRemoteSync)
          .map((s) => (
            <SyncButton key={s.id} source={s} onSynced={onSynced} />
          ))}
        {sources
          .filter((s) => getProvider(s.provider).capabilities.supportsManualFetch)
          .map((s) => (
            <TelegramFetchButton key={s.id} source={s} onSynced={onSynced} />
          ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {hasArchiveSource && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={onOpenWhatsAppUpload}
          >
            <FolderUp className="h-4 w-4 mr-2" />
            Загрузить архив WhatsApp
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={onOpenDropoffUpload}
        >
          <Upload className="h-4 w-4 mr-2" />
          Загрузить файлы
        </Button>
      </div>
    </div>
  )
}

function SyncButton({
  source,
  onSynced,
}: {
  source: SystemSource
  onSynced: () => void
}) {
  const [busy, setBusy] = useState(false)
  const ProviderIcon = getProvider(source.provider).icon

  async function handleClick() {
    setBusy(true)
    try {
      const res = await fetch("/api/sources/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось синхронизировать")
      const { fetched, inserted, updated } = data as {
        fetched: number
        inserted: number
        updated: number
      }
      toast.success(
        `${source.name}: синхронизировано — получено ${fetched} (${inserted} новых, ${updated} обновлено)`,
      )
      onSynced()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Неизвестная ошибка"
      toast.error(`Синхронизация ${source.name}: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8"
      onClick={handleClick}
      disabled={busy}
    >
      {busy ? (
        <Loader className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <ProviderIcon className="h-4 w-4 mr-2" />
      )}
      Синхронизировать {source.name}
    </Button>
  )
}

// Telegram is push (webhook) in production, but exposes a manual getUpdates
// PULL surfaced here — mainly for local dev where the webhook can't reach
// the machine. POSTs to the org-scoped fetch route, which drains queued
// messages into source_items. A 409 (webhook active) comes back as
// `webhookActive: true` — we tell the user messages already arrive
// automatically rather than treating it as an error.
function TelegramFetchButton({
  source,
  onSynced,
}: {
  source: SystemSource
  onSynced: () => void
}) {
  const [busy, setBusy] = useState(false)
  const ProviderIcon = getProvider(source.provider).icon

  async function handleClick() {
    setBusy(true)
    try {
      const res = await fetch("/api/sources/telegram/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось получить")
      const { fetched, ingested, ignored, webhookActive } = data as {
        fetched: number
        ingested: number
        ignored: number
        webhookActive: boolean
      }
      if (webhookActive) {
        toast.info(
          `${source.name}: активен веб-хук — сообщения приходят автоматически, ручная загрузка не нужна.`,
        )
      } else {
        toast.success(
          `${source.name}: получено ${fetched} ${plural(fetched, ["обновление", "обновления", "обновлений"])} (${ingested} принято, ${ignored} пропущено)`,
        )
      }
      onSynced()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Неизвестная ошибка"
      toast.error(`Получение ${source.name}: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8"
      onClick={handleClick}
      disabled={busy}
    >
      {busy ? (
        <Loader className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <ProviderIcon className="h-4 w-4 mr-2" />
      )}
      Получить {source.name}
    </Button>
  )
}
