"use client"

// Owner-managed discovery blocklist UI (see refs/blocklist.md):
//   • <ClientBlocklistDialog> — toolbar dialog: add a rule + the grouped list.
//   • <BlacklistEntityButton> — reusable per-entity "block this row" action.
// Russian UI throughout. Owner-gating here is best-effort; the server is the
// real gate (a non-owner POST returns 403).

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Ban, Loader, Trash2 } from "lucide-react"
import type { BlocklistEntry } from "@/app/api/blocklist/route"

type BlocklistKind = "email" | "domain" | "company" | "person"

const KIND_OPTIONS: { value: BlocklistKind; label: string }[] = [
  { value: "company", label: "Компания" },
  { value: "domain", label: "Домен" },
  { value: "email", label: "Email" },
  { value: "person", label: "Человек" },
]

const KIND_PLACEHOLDER: Record<BlocklistKind, string> = {
  company: "напр. ООО АСТ",
  domain: "напр. example.com",
  email: "напр. noreply@example.com",
  person: "напр. Иван Петров",
}

function sweptToast(result: { sweptClients: number; sweptContacts: number }) {
  const total = result.sweptClients + result.sweptContacts
  if (total > 0) {
    toast.success(
      `Добавлено в список блокировки · скрыто: ${result.sweptClients} клиент(ов), ${result.sweptContacts} контакт(ов)`,
    )
  } else {
    toast.success("Добавлено в список блокировки")
  }
}

export function ClientBlocklistDialog({
  trigger,
  onChanged,
}: {
  trigger: React.ReactNode
  /** Called after any add/remove so the parent can refresh its lists (a new
   *  entry may have hidden rows). */
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<BlocklistEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [kind, setKind] = useState<BlocklistKind>("company")
  const [value, setValue] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/blocklist")
      const data = await res.json()
      if (res.ok) setEntries(data.entries ?? [])
    } catch {
      toast.error("Не удалось загрузить список блокировки")
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
      const res = await fetch("/api/blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value: value.trim(), note: note.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось добавить")
        return
      }
      sweptToast(data)
      setValue("")
      setNote("")
      await load()
      onChanged()
    } catch {
      toast.error("Ошибка сети")
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/blocklist/${id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось удалить")
        return
      }
      toast.success("Удалено из списка блокировки")
      setEntries((prev) => prev.filter((e) => e.id !== id))
      onChanged()
    } catch {
      toast.error("Ошибка сети")
    }
  }

  // Group entries by kind for display.
  const grouped = KIND_OPTIONS.map((k) => ({
    kind: k.value,
    label: k.label,
    items: entries.filter((e) => e.kind === k.value),
  })).filter((g) => g.items.length > 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4" />
            Список блокировки
          </DialogTitle>
          <DialogDescription>
            Компании, люди, домены и адреса, которые не нужно заводить как
            клиентов/контакты. Поиск в источниках и привязка их игнорируют.
            Добавление сразу скрывает уже заведённые подходящие записи.
            Снятие блокировки не возвращает скрытые записи автоматически.
          </DialogDescription>
        </DialogHeader>

        {/* Add row */}
        <div className="flex flex-wrap items-start gap-2 border-b pb-3">
          <Select value={kind} onValueChange={(v) => setKind(v as BlocklistKind)}>
            <SelectTrigger className="w-36">
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

        {/* List */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8">
              <Loader className="h-4 w-4 animate-spin" />
              Загрузка…
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Список блокировки пуст.
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label="Удалить из списка блокировки"
                        title="Удалить из списка блокировки"
                        onClick={() => handleRemove(e.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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

// Reusable per-entity block action — a Ban-icon button + confirm. Blocks the
// row's company/domain (client) or email/person (contact) and hides the row.
export function BlacklistEntityButton({
  entityType,
  id,
  name,
  onBlocked,
}: {
  entityType: "client" | "contact"
  id: string
  name: string
  onBlocked: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      const res = await fetch("/api/blocklist/from-entity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось заблокировать")
        return
      }
      sweptToast(data)
      onBlocked()
    } catch {
      toast.error("Ошибка сети")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Добавить в список блокировки"
          title="Добавить в список блокировки"
        >
          <Ban className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Добавить в список блокировки?</AlertDialogTitle>
          <AlertDialogDescription>
            «{name}» будет скрыт(а) и больше не будет появляться при поиске в
            источниках. {entityType === "client"
              ? "Блокируется название компании (и домен сайта, если указан)."
              : "Блокируется email (или имя, если email отсутствует)."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={busy}>
            {busy ? "Блокировка…" : "Заблокировать"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { sweptToast }
