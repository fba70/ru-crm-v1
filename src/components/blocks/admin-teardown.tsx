"use client"

// Admin "Сброс источника" (source teardown) tab. The unit of deletion is a
// THREAD — one top-level source_item (e.g. a test email) + its children — and
// the artifacts it EXCLUSIVELY produced (clients / contacts / deals / tasks /
// orders). Selecting threads deletes their items + cards + R2 AND the entities
// fully attributable to the selection, together — so items are never nuked out
// from under their entities, and a client/contact shared with a thread/source
// you're NOT deleting is kept. Preview → per-thread selection → typed confirm
// (re-checked + re-decided server-side) → execute. See refs/source-teardown.md.

import { useCallback, useEffect, useMemo, useState } from "react"
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
import { Loader, Trash2, Mail, FileText, CreditCard } from "lucide-react"
import type {
  TeardownPreview,
  TeardownThread,
  TeardownEntity,
} from "@/app/api/admin/teardown/preview/route"

type Source = {
  id: string
  name: string
  provider: string
  organizationId: string
  organizationName: string | null
  itemCount: number
}

export function AdminTeardown() {
  const [sources, setSources] = useState<Source[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [preview, setPreview] = useState<TeardownPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  // Selected thread ids (parent source_item ids). Default: nothing — the
  // operator reviews and picks the test threads to wipe (or "select all").
  const [selThreads, setSelThreads] = useState<Set<string>>(new Set())

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
    setSelThreads(new Set())
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
      setSelThreads(new Set())
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

  function toggleThread(id: string) {
    setSelThreads((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allThreadIds = useMemo(
    () => (preview ? preview.threads.map((t) => t.id) : []),
    [preview],
  )
  const allSelected =
    allThreadIds.length > 0 && selThreads.size === allThreadIds.length
  function toggleAll() {
    setSelThreads(allSelected ? new Set() : new Set(allThreadIds))
  }

  // Exact, server-matching live estimate of what WILL be deleted: walk every
  // thread's entities, keep each id once, and count it deletable iff it can be
  // removed here (no producer in another source) AND all its producing threads
  // are selected.
  const estimate = useMemo(() => {
    let items = 0
    let cards = 0
    const delClients = new Set<string>()
    const delContacts = new Set<string>()
    const sharedKept = new Set<string>()
    if (!preview) return { items, cards, clients: 0, contacts: 0, shared: 0 }
    for (const t of preview.threads) {
      if (!selThreads.has(t.id)) continue
      items += t.itemCount
      cards += t.cardCount
    }
    const consider = (e: TeardownEntity, bucket: Set<string>) => {
      const touched = e.producingThreadIds.some((id) => selThreads.has(id))
      if (!touched) return
      const deletable =
        e.itemsInOtherSources === 0 &&
        e.producingThreadIds.every((id) => selThreads.has(id))
      if (deletable) bucket.add(e.id)
      else sharedKept.add(e.id)
    }
    for (const t of preview.threads) {
      for (const c of t.clients) consider(c, delClients)
      for (const c of t.contacts) consider(c, delContacts)
    }
    // An entity counted deletable under one thread can't also be "kept".
    for (const id of delClients) sharedKept.delete(id)
    for (const id of delContacts) sharedKept.delete(id)
    return {
      items,
      cards,
      clients: delClients.size,
      contacts: delContacts.size,
      shared: sharedKept.size,
    }
  }, [preview, selThreads])

  const armed =
    !!preview &&
    selThreads.size > 0 &&
    confirmText.trim() === preview.source.name.trim() &&
    !executing

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
          threadIds: [...selThreads],
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось выполнить сброс")
        return
      }
      const c = data.counts as {
        threads: number
        sourceItems: number
        cards: number
        clients: number
        contacts: number
        deals: number
        tasks: number
        orders: number
        sharedSkipped: number
        cursorReset: boolean
      }
      toast.success(
        `Удалено · тредов ${c.threads} · элементов ${c.sourceItems} · ` +
          `карточек ${c.cards} · клиентов ${c.clients} · контактов ${c.contacts} · ` +
          `сделок ${c.deals} · задач ${c.tasks} · заказов ${c.orders}` +
          (c.sharedSkipped > 0 ? ` · оставлено общих ${c.sharedSkipped}` : "") +
          (c.cursorReset ? " · курсор сброшен" : ""),
      )
      await loadSources()
      await runPreview(preview.source.id)
    } catch {
      toast.error("Ошибка сети")
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Удаляет выбранные «треды» источника (например, тестовое письмо со всеми
          вложениями) вместе с артефактами, которые они породили — карточки,
          клиенты, контакты, сделки, задачи, заказы. Клиент или контакт,
          встречающийся ещё в другом треде / источнике, не удаляется (помечен ⚠).
          Полный сброс источника = «Выбрать все треды» (тогда сбрасывается и
          курсор синхронизации). Действие необратимо.
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
        <div className="space-y-4">
          {preview.threads.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              У этого источника нет элементов — удалять нечего.
            </p>
          ) : (
            <>
              {/* Select-all + live estimate */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  Выбрать все треды ({selThreads.size}/{allThreadIds.length})
                </label>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Chip label="Элементы" value={estimate.items} />
                  <Chip label="Карточки" value={estimate.cards} />
                  <Chip label="Клиенты" value={estimate.clients} primary />
                  <Chip label="Контакты" value={estimate.contacts} primary />
                  {estimate.shared > 0 && (
                    <Chip label="⚠ оставлено общих" value={estimate.shared} />
                  )}
                </div>
              </div>

              {/* Thread tree */}
              <div className="space-y-2">
                {preview.threads.map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    selected={selThreads.has(t.id)}
                    selThreads={selThreads}
                    onToggle={() => toggleThread(t.id)}
                  />
                ))}
              </div>

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
                  <Button variant="destructive" onClick={execute} disabled={!armed}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    {executing
                      ? "Удаление…"
                      : `Сбросить выбранное (${selThreads.size})`}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({
  label,
  value,
  primary,
}: {
  label: string
  value: number
  primary?: boolean
}) {
  return (
    <div
      className={
        "rounded-md border px-3 py-1.5 " +
        (primary ? "border-primary/40 bg-primary/5" : "")
      }
    >
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function ThreadRow({
  thread,
  selected,
  selThreads,
  onToggle,
}: {
  thread: TeardownThread
  selected: boolean
  selThreads: Set<string>
  onToggle: () => void
}) {
  const date = thread.date ? thread.date.slice(0, 10) : ""
  return (
    <div
      className={
        "rounded-md border " + (selected ? "border-primary/50 bg-primary/5" : "")
      }
    >
      <label className="flex cursor-pointer items-start gap-3 px-3 py-2">
        <Checkbox checked={selected} onCheckedChange={onToggle} className="mt-0.5" />
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{thread.title}</span>
            {date && (
              <span className="shrink-0 text-xs text-muted-foreground">{date}</span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {thread.itemCount} элем.
            </span>
            {thread.cardCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <CreditCard className="h-3 w-3" />
                {thread.cardCount} карт.
              </span>
            )}
          </div>
        </div>
      </label>

      {(thread.clients.length > 0 || thread.contacts.length > 0) && (
        <div className="space-y-1.5 border-t px-3 py-2 pl-10">
          <EntityGroup title="Клиенты" rows={thread.clients} selThreads={selThreads} />
          <EntityGroup title="Контакты" rows={thread.contacts} selThreads={selThreads} />
        </div>
      )}
    </div>
  )
}

function EntityGroup({
  title,
  rows,
  selThreads,
}: {
  title: string
  rows: TeardownEntity[]
  selThreads: Set<string>
}) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {rows.map((e) => {
        // Never removable via this source (a producer lives in another source).
        const otherSource = e.itemsInOtherSources > 0
        // Will it actually be deleted under the current selection?
        const willDelete =
          !otherSource && e.producingThreadIds.every((id) => selThreads.has(id))
        return (
          <div
            key={e.id}
            className="flex items-center gap-2 text-sm"
          >
            <span
              className={
                "min-w-0 flex-1 truncate " +
                (willDelete ? "" : "text-muted-foreground")
              }
            >
              {e.name}
            </span>
            {e.status === "deleted" && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground">
                уже удалён
              </Badge>
            )}
            {e.orderCount > 0 && (
              <Badge className="text-[10px] px-1 py-0 bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30">
                заказов: {e.orderCount}
              </Badge>
            )}
            {otherSource ? (
              <Badge className="text-[10px] px-1 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
                ⚠ в др. источнике — не удалить
              </Badge>
            ) : e.otherThreadsInSource > 0 ? (
              <Badge className="text-[10px] px-1 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
                ⚠ ещё в {e.otherThreadsInSource} тред.
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] px-1 py-0">
                только этот тред
              </Badge>
            )}
          </div>
        )
      })}
    </div>
  )
}
