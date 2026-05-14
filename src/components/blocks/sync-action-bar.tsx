"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FolderUp, Loader, Upload } from "lucide-react"
import { toast } from "sonner"
import type { SystemSource } from "@/server/sources"
import { getProvider, PROVIDER_LIST } from "@/lib/sources/providers"

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
            Sync WhatsApp Archive
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={onOpenDropoffUpload}
        >
          <Upload className="h-4 w-4 mr-2" />
          Drop Off Your Files
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
      if (!res.ok) throw new Error(data.error || "Sync failed")
      const { fetched, inserted, updated } = data as {
        fetched: number
        inserted: number
        updated: number
      }
      toast.success(
        `${source.name} synced — ${fetched} fetched (${inserted} new, ${updated} updated)`,
      )
      onSynced()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      toast.error(`Sync ${source.name}: ${msg}`)
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
      Sync {source.name}
    </Button>
  )
}
