"use client"

// Own-organisation identity registry UI — opened from the organisation card on
// /account. Lets the OWNER declare the extra names / synonyms, websites and
// postal addresses that mean "this is us", so parsing and discovery stop
// creating the company as a client.
//
// The organisation profile (name / website / address) is the PRIMARY identity
// and is already counted — it is rendered here read-only as context so the
// owner doesn't re-enter it.
//
// Owner-gating here is best-effort; the server is the real gate (a non-owner
// POST returns 403). Russian UI throughout.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BadgeCheck, Loader, Trash2, TriangleAlert } from "lucide-react"
import type {
  IdentityMatches,
  OrgIdentityEntryView,
} from "@/app/api/org-identity/route"

type Kind = "name" | "website" | "address"

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: "name", label: "Название" },
  { value: "website", label: "Сайт" },
  { value: "address", label: "Адрес" },
]

const KIND_PLACEHOLDER: Record<Kind, string> = {
  name: "напр. ООО АСТ или AST INTER",
  website: "напр. ast-inter.ru",
  address: "напр. г. Москва, ул. Ленина, д. 5",
}

const KIND_HINT: Record<Kind, string> = {
  name: "Синоним или второе торговое название вашей компании.",
  website:
    "Ещё один домен компании. Письма с этого домена считаются нашими, а сам домен не станет клиентом.",
  address:
    "Почтовый адрес компании. Укажите город и улицу — по одному слову совпадение не срабатывает.",
}

export function OrgIdentityDialog({
  trigger,
  organizationName,
  organizationWebUrl,
  organizationAddress,
  onChanged,
}: {
  trigger: React.ReactNode
  organizationName?: string | null
  organizationWebUrl?: string | null
  organizationAddress?: string | null
  /** Called after any add/remove, so the parent can refresh if it wants. */
  onChanged?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<OrgIdentityEntryView[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(false)
  const [kind, setKind] = useState<Kind>("name")
  const [value, setValue] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [matches, setMatches] = useState<IdentityMatches | null>(null)
  const [resolved, setResolved] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/org-identity")
      const data = await res.json()
      if (res.ok) {
        setEntries(data.entries ?? [])
        setCanManage(Boolean(data.canManage))
      } else {
        toast.error(data.error ?? "Не удалось загрузить реестр")
      }
    } catch {
      toast.error("Не удалось загрузить реестр")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function handleAdd() {
    if (!value.trim()) {
      toast.error("Укажите значение")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/org-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value: value.trim(), note: note.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось добавить")
        return
      }
      toast.success(
        data.added > 0 ? "Добавлено в реестр" : "Такая запись уже есть",
      )
      setValue("")
      setNote("")
      const found =
        (data.matches?.clients?.length ?? 0) +
        (data.matches?.contacts?.length ?? 0)
      setMatches(found > 0 ? data.matches : null)
      setResolved(new Set())
      await load()
      onChanged?.()
    } catch {
      toast.error("Ошибка сети")
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/org-identity/${id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось удалить")
        return
      }
      toast.success("Удалено из реестра")
      setEntries((prev) => prev.filter((e) => e.id !== id))
      onChanged?.()
    } catch {
      toast.error("Ошибка сети")
    }
  }

  // Soft-delete a wrongly-created client/contact through the existing CRUD
  // endpoints (partial update — only `status` is sent).
  async function handleDeleteEntity(
    entity: "client" | "contact",
    id: string,
    name: string,
  ) {
    try {
      const res = await fetch(
        entity === "client" ? "/api/clients" : "/api/contacts",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status: "deleted" }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось удалить")
        return
      }
      toast.success(`«${name}» удалён(а)`)
      setResolved((prev) => new Set(prev).add(id))
      onChanged?.()
    } catch {
      toast.error("Ошибка сети")
    }
  }

  const grouped = KIND_OPTIONS.map((k) => ({
    kind: k.value,
    label: k.label,
    items: entries.filter((e) => e.kind === k.value),
  })).filter((g) => g.items.length > 0)

  const matchRows = [
    ...(matches?.clients ?? []).map((m) => ({ ...m, entity: "client" as const })),
    ...(matches?.contacts ?? []).map((m) => ({
      ...m,
      entity: "contact" as const,
    })),
  ].filter((m) => !resolved.has(m.id))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4" />
            Своя организация
          </DialogTitle>
          <DialogDescription>
            Названия, сайты и адреса, по которым система узнаёт вашу
            собственную компанию при разборе источников. Всё перечисленное здесь
            не станет клиентом и не попадёт в контакты, а письма и документы с
            этими признаками считаются нашими.
          </DialogDescription>
        </DialogHeader>

        {/* Primary identity from the organisation profile — already counted. */}
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-1">
          <div className="font-medium text-muted-foreground">
            Из профиля организации (учитывается всегда):
          </div>
          <div className="flex flex-wrap gap-1.5">
            {organizationName && (
              <Badge variant="secondary" className="font-normal">
                {organizationName}
              </Badge>
            )}
            {organizationWebUrl && (
              <Badge variant="secondary" className="font-normal">
                {organizationWebUrl}
              </Badge>
            )}
            {organizationAddress && (
              <Badge variant="secondary" className="font-normal">
                {organizationAddress}
              </Badge>
            )}
            {!organizationName &&
              !organizationWebUrl &&
              !organizationAddress && (
                <span className="text-muted-foreground">
                  Профиль не заполнен — добавьте название, сайт и адрес в
                  «Редактировать организацию».
                </span>
              )}
          </div>
        </div>

        {/* Add row (owner only) */}
        {canManage && (
          <div className="space-y-1.5 border-b pb-3">
            <div className="flex flex-wrap items-start gap-2">
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={KIND_PLACEHOLDER[kind]}
                className="flex-1 min-w-40"
                autoComplete="off"
                spellCheck={false}
              />
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Примечание (необязательно)"
                className="flex-1 min-w-40"
                autoComplete="off"
              />
              <Button onClick={handleAdd} disabled={busy}>
                {busy ? "Добавление…" : "Добавить"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
          </div>
        )}

        {/* Retroactive matches — report only, the owner decides row by row. */}
        {matchRows.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
            <div className="flex items-start gap-2 text-sm">
              <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <div className="flex-1">
                <div className="font-medium">
                  Эти записи похожи на вашу организацию
                </div>
                <div className="text-xs text-muted-foreground">
                  Они были заведены раньше. Ничего не изменено автоматически —
                  удалите лишнее вручную. Заново система их не создаст.
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => setMatches(null)}
              >
                Скрыть
              </Button>
            </div>
            <div className="rounded-md border divide-y bg-background">
              {matchRows.map((m) => (
                <div
                  key={`${m.entity}-${m.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm"
                >
                  <Badge variant="outline" className="shrink-0 font-normal">
                    {m.entity === "client" ? "Клиент" : "Контакт"}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.name}</div>
                    {m.detail && (
                      <div className="text-xs text-muted-foreground truncate">
                        {m.detail}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0"
                    onClick={() =>
                      handleDeleteEntity(m.entity, m.id, m.name)
                    }
                  >
                    Удалить
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Registry list */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8">
              <Loader className="h-4 w-4 animate-spin" />
              Загрузка…
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Реестр пуст — учитывается только профиль организации.
            </p>
          ) : (
            grouped.map((g) => (
              <div key={g.kind} className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">
                  {g.label} ({g.items.length})
                </div>
                <div className="rounded-md border divide-y">
                  {g.items.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{e.label}</div>
                        {e.note && (
                          <div className="text-xs text-muted-foreground truncate">
                            {e.note}
                          </div>
                        )}
                      </div>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => handleRemove(e.id)}
                          aria-label="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
