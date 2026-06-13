"use client"

import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Globe, Loader, ExternalLink, AlertTriangle } from "lucide-react"
import type { ClientRow } from "@/app/api/clients/route"
import type {
  ClientLookupCandidate,
  ClientLookupResult,
  ClientLookupSource,
} from "@/app/api/clients/[id]/lookup/route"

type Phase =
  | "idle"
  | "searching"
  | "select-candidate"
  | "edit"
  | "saving"
  | "no-results"

const CONFIDENCE_COLOR: Record<ClientLookupCandidate["confidence"], string> = {
  high: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  medium: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  low: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
}

// UI labels for the self-rated confidence levels.
const CONFIDENCE_LABEL: Record<ClientLookupCandidate["confidence"], string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
}

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

export function ClientLookupDialog({
  client,
  trigger,
  onSaved,
}: {
  client: ClientRow
  trigger: React.ReactNode
  /** Called after a successful PUT so the parent can refresh its list. */
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [result, setResult] = useState<ClientLookupResult | null>(null)
  const [chosen, setChosen] = useState<ClientLookupCandidate | null>(null)
  // Edit-form state — mirrors the writable client.* fields. Pre-filled
  // from the chosen candidate (with current value as fallback per Q6).
  const [draft, setDraft] = useState({
    name: client.name,
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    webUrl: client.webUrl ?? "",
  })

  const reset = useCallback(() => {
    setPhase("idle")
    setResult(null)
    setChosen(null)
    setDraft({
      name: client.name,
      email: client.email ?? "",
      phone: client.phone ?? "",
      address: client.address ?? "",
      webUrl: client.webUrl ?? "",
    })
  }, [client])

  const startLookup = useCallback(async () => {
    setPhase("searching")
    try {
      const res = await fetch(`/api/clients/${client.id}/lookup`, {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось выполнить поиск")
      const r = data as ClientLookupResult
      setResult(r)
      if (r.candidates.length === 0) {
        setPhase("no-results")
        return
      }
      if (r.candidates.length === 1) {
        // Skip the selector — apply unconditionally per the design.
        applyCandidate(r.candidates[0])
        setPhase("edit")
      } else {
        setPhase("select-candidate")
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось выполнить поиск",
      )
      setOpen(false)
      reset()
    }
    // applyCandidate captured via closure below — see useCallback chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id, reset])

  // Pre-fill the editable draft from a chosen candidate. For each field,
  // prefer the found value when non-empty; otherwise keep the current
  // client value (or "").
  const applyCandidate = useCallback(
    (cand: ClientLookupCandidate) => {
      setChosen(cand)
      setDraft({
        name: cand.name || client.name,
        email: cand.email || (client.email ?? ""),
        phone: cand.phone || (client.phone ?? ""),
        address: cand.address || (client.address ?? ""),
        webUrl: cand.webUrl || (client.webUrl ?? ""),
      })
    },
    [client],
  )

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) {
        startLookup()
      } else {
        reset()
      }
    },
    [startLookup, reset],
  )

  const pickCandidate = useCallback(
    (cand: ClientLookupCandidate) => {
      applyCandidate(cand)
      setPhase("edit")
    },
    [applyCandidate],
  )

  const save = useCallback(async () => {
    if (!draft.name.trim()) {
      toast.error("Укажите название")
      return
    }
    setPhase("saving")
    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: client.id,
          name: draft.name.trim(),
          email: draft.email.trim() || null,
          phone: draft.phone.trim() || null,
          address: draft.address.trim() || null,
          webUrl: draft.webUrl.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить")
      toast.success("Клиент обновлён")
      onSaved()
      setOpen(false)
      reset()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить")
      setPhase("edit")
    }
  }, [client.id, draft, onSaved, reset])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Поиск в интернете
          </DialogTitle>
          <DialogDescription>
            Ищет компанию в интернете и предлагает обновить её контактные
            данные. Проверьте и отредактируйте перед сохранением.
          </DialogDescription>
        </DialogHeader>

        {phase === "searching" && (
          <CenterMessage>
            <Loader className="h-6 w-6 animate-spin" />
            <span className="text-sm text-muted-foreground">
              Поиск в интернете: {client.name}…
            </span>
          </CenterMessage>
        )}

        {phase === "no-results" && (
          <CenterMessage>
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            <div className="text-sm text-center text-muted-foreground max-w-md">
              Совпадений не найдено. Уточните название клиента и запустите поиск
              снова.
            </div>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Закрыть
            </Button>
          </CenterMessage>
        )}

        {phase === "select-candidate" && result && (
          <CandidateSelector
            candidates={result.candidates}
            sources={result.sources}
            notes={result.notes}
            onPick={pickCandidate}
            onCancel={() => handleOpenChange(false)}
          />
        )}

        {(phase === "edit" || phase === "saving") && chosen && result && (
          <EditView
            currentClient={client}
            chosen={chosen}
            draft={draft}
            setDraft={setDraft}
            sources={result.sources}
            notes={result.notes}
            saving={phase === "saving"}
            onSave={save}
            onBack={
              result.candidates.length > 1
                ? () => setPhase("select-candidate")
                : null
            }
            onCancel={() => handleOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Sub-views ───────────────────────────────────────────────────────

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12">
      {children}
    </div>
  )
}

function CandidateSelector({
  candidates,
  sources,
  notes,
  onPick,
  onCancel,
}: {
  candidates: ClientLookupCandidate[]
  sources: ClientLookupSource[]
  notes: string
  onPick: (c: ClientLookupCandidate) => void
  onCancel: () => void
}) {
  return (
    <>
      <div className="text-xs text-muted-foreground border-b pb-2">
        Найдено {candidates.length}{" "}
        {plural(candidates.length, [
          "совпадение",
          "совпадения",
          "совпадений",
        ])}
        . Выберите подходящее, чтобы продолжить.
      </div>

      {notes && (
        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
          {notes}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
        {candidates.map((c, i) => (
          <button
            key={i}
            type="button"
            className="w-full text-left rounded-md border p-3 hover:bg-muted/40 hover:border-primary/40 transition-colors space-y-1"
            onClick={() => onPick(c)}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{c.name}</span>
              <Badge
                variant="secondary"
                className={CONFIDENCE_COLOR[c.confidence]}
              >
                {CONFIDENCE_LABEL[c.confidence]}
              </Badge>
            </div>
            {c.address && (
              <div className="text-xs text-muted-foreground">{c.address}</div>
            )}
            {c.webUrl && (
              <a
                href={c.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                {c.webUrl}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {c.whyMatch && (
              <div className="text-xs italic text-muted-foreground">
                {c.whyMatch}
              </div>
            )}
          </button>
        ))}
      </div>

      <SourcesBlock sources={sources} />

      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Ни одно из них
        </Button>
      </DialogFooter>
    </>
  )
}

function EditView({
  currentClient,
  chosen,
  draft,
  setDraft,
  sources,
  notes,
  saving,
  onSave,
  onBack,
  onCancel,
}: {
  currentClient: ClientRow
  chosen: ClientLookupCandidate
  draft: { name: string; email: string; phone: string; address: string; webUrl: string }
  setDraft: React.Dispatch<
    React.SetStateAction<{
      name: string
      email: string
      phone: string
      address: string
      webUrl: string
    }>
  >
  sources: ClientLookupSource[]
  notes: string
  saving: boolean
  onSave: () => void
  onBack: (() => void) | null
  onCancel: () => void
}) {
  // Compute "changed" per field by comparing draft to the original client.
  const isChanged = useCallback(
    (field: "name" | "email" | "phone" | "address" | "webUrl") => {
      const current = (currentClient[field] ?? "").trim()
      const next = draft[field].trim()
      return current !== next
    },
    [currentClient, draft],
  )

  // Auto-warn when low confidence — gives the user pause before saving.
  const lowConfidence = chosen.confidence === "low"

  return (
    <>
      {(notes || lowConfidence) && (
        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md p-2 space-y-1">
          {lowConfidence && (
            <div className="flex items-center gap-1 font-medium">
              <AlertTriangle className="h-3 w-3" />
              Совпадение с низкой уверенностью — проверьте внимательно перед
              сохранением.
            </div>
          )}
          {notes && <div>{notes}</div>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3 -mx-1 px-1">
        <FieldRow
          label="Название"
          value={draft.name}
          onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
          changed={isChanged("name")}
        />
        <FieldRow
          label="Email"
          value={draft.email}
          onChange={(v) => setDraft((d) => ({ ...d, email: v }))}
          changed={isChanged("email")}
          placeholder="info@example.com"
        />
        <FieldRow
          label="Телефон"
          value={draft.phone}
          onChange={(v) => setDraft((d) => ({ ...d, phone: v }))}
          changed={isChanged("phone")}
          placeholder="+7 495 123 4567"
        />
        <FieldRow
          label="Адрес"
          value={draft.address}
          onChange={(v) => setDraft((d) => ({ ...d, address: v }))}
          changed={isChanged("address")}
          placeholder="Улица, город, страна"
        />
        <FieldRow
          label="Сайт"
          value={draft.webUrl}
          onChange={(v) => setDraft((d) => ({ ...d, webUrl: v }))}
          changed={isChanged("webUrl")}
          placeholder="https://example.com"
        />
      </div>

      <SourcesBlock sources={sources} />

      <DialogFooter className="gap-2">
        {onBack && (
          <Button variant="ghost" onClick={onBack} disabled={saving}>
            Назад
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? (
            <>
              <Loader className="h-4 w-4 mr-1 animate-spin" />
              Сохранение…
            </>
          ) : (
            "Сохранить"
          )}
        </Button>
      </DialogFooter>
    </>
  )
}

function FieldRow({
  label,
  value,
  onChange,
  changed,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  changed: boolean
  placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {changed && (
          <Badge
            variant="secondary"
            className="bg-blue-500/15 text-blue-600 dark:text-blue-300 text-[10px] px-1.5 py-0 h-4"
          >
            изменено
          </Badge>
        )}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

function SourcesBlock({ sources }: { sources: ClientLookupSource[] }) {
  const [expanded, setExpanded] = useState(false)

  // Cap the visible list to keep the modal compact; "show more" reveals
  // the rest. Domains are deduped so the UI doesn't repeat "linkedin.com"
  // 5 times.
  const dedupedByDomain = useMemo(() => {
    const seen = new Set<string>()
    const out: ClientLookupSource[] = []
    for (const s of sources) {
      try {
        const host = new URL(s.url).host
        if (seen.has(host)) continue
        seen.add(host)
        out.push(s)
      } catch {
        out.push(s)
      }
    }
    return out
  }, [sources])

  if (sources.length === 0) return null

  const visible = expanded ? dedupedByDomain : dedupedByDomain.slice(0, 4)

  return (
    <div className="border-t pt-2 space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        Источники
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {visible.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
            title={s.title}
          >
            {(() => {
              try {
                return new URL(s.url).host
              } catch {
                return s.url
              }
            })()}
            <ExternalLink className="h-3 w-3" />
          </a>
        ))}
        {dedupedByDomain.length > 4 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs text-muted-foreground hover:underline"
          >
            +{dedupedByDomain.length - 4} ещё
          </button>
        )}
      </div>
    </div>
  )
}

