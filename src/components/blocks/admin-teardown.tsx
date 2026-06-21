"use client"

// Admin "Сброс источника" (source teardown) tab. Hard-deletes everything one
// source produced — its items + R2 markdown, the cards from them, and the
// clients/contacts/deals/tasks/orders they triggered — and resets the sync
// cursor, so the same test/demo can be replayed cleanly. Dry-run preview →
// per-row selection → typed confirm (re-checked server-side) → execute.
// See refs/source-teardown.md.

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
import { Loader, Trash2 } from "lucide-react"
import type { TeardownPreview } from "@/app/api/admin/teardown/preview/route"

type Source = {
  id: string
  name: string
  provider: string
  organizationId: string
  organizationName: string | null
  itemCount: number
}

// Source footprint — ALWAYS deleted (the source's own items + their blobs/cards),
// independent of which clients/contacts the operator checks.
const FOOTPRINT_LABELS: { key: keyof TeardownPreview["counts"]; label: string }[] = [
  { key: "sourceItems", label: "Элементы" },
  { key: "childItems", label: "Дочерние" },
  { key: "r2Objects", label: "Файлы R2" },
  { key: "cards", label: "Карточки" },
]

export function AdminTeardown() {
  const [sources, setSources] = useState<Source[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [preview, setPreview] = useState<TeardownPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  // Explicit per-row selection (every row is freely toggleable). Initialised to
  // the exclusive rows when a preview loads.
  const [selClients, setSelClients] = useState<Set<string>>(new Set())
  const [selContacts, setSelContacts] = useState<Set<string>>(new Set())

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
    setSelClients(new Set())
    setSelContacts(new Set())
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
      const p = data as TeardownPreview
      setPreview(p)
      // Default selection = nothing. The operator reviews the list and
      // explicitly checks the rows they want deleted.
      setSelClients(new Set())
      setSelContacts(new Set())
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
          deleteClientIds: [...selClients],
          deleteContactIds: [...selContacts],
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
          `клиентов ${c.clients} · контактов ${c.contacts} · сделок ${c.deals} · ` +
          `задач ${c.tasks} · заказов ${c.orders}`,
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
          R2, карточки и созданные из них клиенты / контакты / сделки / задачи /
          заказы), и сбрасывает курсор синхронизации — чтобы тот же тестовый
          сценарий можно было прогнать заново «с чистого листа». Действие
          необратимо.
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
          {/* Counts — footprint (always deleted) + live selection */}
          <div className="flex flex-wrap gap-2">
            {FOOTPRINT_LABELS.map((c) => (
              <div
                key={c.key}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                <span className="text-muted-foreground">{c.label}: </span>
                <span className="font-medium">{preview.counts[c.key]}</span>
              </div>
            ))}
            <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Выбрано клиентов: </span>
              <span className="font-medium">{selClients.size}</span>
            </div>
            <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Выбрано контактов: </span>
              <span className="font-medium">{selContacts.size}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Элементы / файлы R2 / карточки источника удаляются всегда. Клиенты и
            контакты — только отмеченные ниже (по умолчанию ничего не выбрано).
            Связанные сделки, задачи и заказы выбранных клиентов удаляются вместе
            с ними; их итоговое число считается на сервере и попадёт в отчёт.
          </p>

          {/* Clients */}
          <EntityList
            title="Клиенты"
            rows={preview.clients}
            selected={selClients}
            onToggle={(id) => toggle(selClients, setSelClients, id)}
          />
          {/* Contacts */}
          <EntityList
            title="Контакты"
            rows={preview.contacts}
            selected={selContacts}
            onToggle={(id) => toggle(selContacts, setSelContacts, id)}
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
  status: string
  orderCount?: number
}

function EntityList({
  title,
  rows,
  selected,
  onToggle,
}: {
  title: string
  rows: EntityRow[]
  selected: Set<string>
  onToggle: (id: string) => void
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
        {title} ({selected.size}/{rows.length})
      </div>
      <div className="rounded-md border divide-y">
        {rows.map((r) => (
          <label
            key={r.id}
            className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40"
          >
            <Checkbox
              checked={selected.has(r.id)}
              onCheckedChange={() => onToggle(r.id)}
            />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {r.status === "deleted" && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground">
                уже удалён
              </Badge>
            )}
            {typeof r.orderCount === "number" && r.orderCount > 0 && (
              <Badge className="text-[10px] px-1 py-0 bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30">
                заказов: {r.orderCount}
              </Badge>
            )}
            {r.exclusive ? (
              <Badge variant="secondary" className="text-[10px] px-1 py-0">
                только этот источник
              </Badge>
            ) : (
              <Badge className="text-[10px] px-1 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
                также в {r.otherItemCount} др. элем.
              </Badge>
            )}
          </label>
        ))}
      </div>
    </div>
  )
}
