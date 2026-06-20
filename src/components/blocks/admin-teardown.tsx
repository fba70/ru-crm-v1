"use client"

// Admin "Сброс источника" (source teardown) tab. Hard-deletes everything one
// source produced — its items + R2 markdown, the cards from them, and the
// clients/contacts/deals/tasks they triggered — and resets the sync cursor, so
// the same test/demo can be replayed cleanly. Dry-run preview → typed confirm
// (re-checked server-side) → execute. See refs/source-teardown.md.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { AlertTriangle, Loader, Trash2 } from "lucide-react"
import type { TeardownPreview } from "@/app/api/admin/teardown/preview/route"

type Source = {
  id: string
  name: string
  provider: string
  organizationId: string
  organizationName: string | null
  itemCount: number
}

const COUNT_LABELS: { key: keyof TeardownPreview["counts"]; label: string }[] = [
  { key: "sourceItems", label: "Элементы" },
  { key: "childItems", label: "Дочерние" },
  { key: "r2Objects", label: "Файлы R2" },
  { key: "cards", label: "Карточки" },
  { key: "clients", label: "Клиенты" },
  { key: "contacts", label: "Контакты" },
  { key: "deals", label: "Сделки" },
  { key: "tasks", label: "Задачи" },
]

export function AdminTeardown() {
  const [sources, setSources] = useState<Source[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [preview, setPreview] = useState<TeardownPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [sharedClients, setSharedClients] = useState<Set<string>>(new Set())
  const [sharedContacts, setSharedContacts] = useState<Set<string>>(new Set())

  const loadSources = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/teardown/sources")
      const data = await res.json()
      if (res.ok) setSources(data.sources ?? [])
      else toast.error(data.error ?? "Не удалось загрузить источники")
    } catch {
      toast.error("Ошибка сети")
    }
  }, [])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  const runPreview = useCallback(async (sourceId: string) => {
    setLoadingPreview(true)
    setPreview(null)
    setConfirmText("")
    setSharedClients(new Set())
    setSharedContacts(new Set())
    try {
      const res = await fetch("/api/admin/teardown/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось построить предпросмотр")
        return
      }
      setPreview(data as TeardownPreview)
    } catch {
      toast.error("Ошибка сети")
    } finally {
      setLoadingPreview(false)
    }
  }, [])

  function onSelect(id: string) {
    setSelectedId(id)
    runPreview(id)
  }

  const armed =
    !!preview && confirmText.trim() === preview.source.name.trim() && !executing

  async function execute() {
    if (!preview || !armed) return
    setExecuting(true)
    try {
      const res = await fetch("/api/admin/teardown/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: preview.source.id,
          confirmText,
          includeSharedClientIds: [...sharedClients],
          includeSharedContactIds: [...sharedContacts],
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось выполнить сброс")
        return
      }
      const c = data.counts as TeardownPreview["counts"]
      toast.success(
        `Удалено · элементов ${c.sourceItems} · карточек ${c.cards} · ` +
          `клиентов ${c.clients} · контактов ${c.contacts} · сделок ${c.deals} · задач ${c.tasks}`,
      )
      // Reload the picker (item counts changed) + re-preview the same source.
      await loadSources()
      await runPreview(preview.source.id)
    } catch {
      toast.error("Ошибка сети")
    } finally {
      setExecuting(false)
    }
  }

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Полностью удаляет всё, что породил выбранный источник (элементы, файлы
          R2, карточки и созданные из них клиенты / контакты / сделки / задачи),
          и сбрасывает курсор синхронизации — чтобы тот же тестовый сценарий
          можно было прогнать заново «с чистого листа». Действие необратимо.
        </p>
      </div>

      {/* Source picker */}
      <div className="max-w-xl">
        <Select value={selectedId} onValueChange={onSelect}>
          <SelectTrigger>
            <SelectValue placeholder="Выберите источник…" />
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {(s.organizationName ?? "—") + " — " + s.name + " (" + s.provider + ") · " + s.itemCount + " элем."}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loadingPreview && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader className="h-4 w-4 animate-spin" />
          Построение предпросмотра…
        </div>
      )}

      {preview && !loadingPreview && (
        <div className="space-y-5">
          {/* Counts */}
          <div className="flex flex-wrap gap-2">
            {COUNT_LABELS.map((c) => (
              <div
                key={c.key}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                <span className="text-muted-foreground">{c.label}: </span>
                <span className="font-medium">{preview.counts[c.key]}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Счётчики сделок/задач показаны для набора по умолчанию (только
            эксклюзивные записи). При включении «общих» записей итог
            пересчитывается на сервере.
          </p>

          {/* Order-blocked clients */}
          {preview.blockedByOrders.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                Пропущены (есть заказы — удалить нельзя)
              </div>
              <div className="text-xs text-muted-foreground">
                {preview.blockedByOrders.map((b) => b.name).join(", ")}
              </div>
            </div>
          )}

          {/* Clients */}
          <EntityList
            title="Клиенты"
            rows={preview.clients.filter((c) => !c.hasOrders)}
            sharedSelected={sharedClients}
            onToggleShared={(id) =>
              toggle(sharedClients, setSharedClients, id)
            }
          />
          {/* Contacts */}
          <EntityList
            title="Контакты"
            rows={preview.contacts}
            sharedSelected={sharedContacts}
            onToggleShared={(id) =>
              toggle(sharedContacts, setSharedContacts, id)
            }
          />

          {/* Typed confirm + execute */}
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
            <p className="text-sm">
              Чтобы подтвердить, введите название источника:{" "}
              <code className="px-1 bg-muted rounded text-xs">
                {preview.source.name}
              </code>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={preview.source.name}
                className="max-w-xs"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                variant="destructive"
                onClick={execute}
                disabled={!armed}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {executing ? "Удаление…" : "Сбросить источник"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type EntityRow = {
  id: string
  name: string
  exclusive: boolean
  otherItemCount: number
}

function EntityList({
  title,
  rows,
  sharedSelected,
  onToggleShared,
}: {
  title: string
  rows: EntityRow[]
  sharedSelected: Set<string>
  onToggleShared: (id: string) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="space-y-1.5">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">Совпадений нет.</p>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">
        {title} ({rows.length})
      </div>
      <div className="rounded-md border divide-y">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Checkbox
              checked={r.exclusive || sharedSelected.has(r.id)}
              disabled={r.exclusive}
              onCheckedChange={() => {
                if (!r.exclusive) onToggleShared(r.id)
              }}
            />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {r.exclusive ? (
              <Badge variant="secondary" className="text-[10px] px-1 py-0">
                только этот источник
              </Badge>
            ) : (
              <Badge className="text-[10px] px-1 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
                также в {r.otherItemCount} др. элем.
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
