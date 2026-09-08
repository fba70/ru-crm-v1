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
import {
  Globe,
  Loader,
  ExternalLink,
  AlertTriangle,
  Search,
  RotateCw,
} from "lucide-react"
import type { ClientRow } from "@/app/api/clients/route"
import type {
  ClientLookupCandidate,
  ClientLookupHints,
  ClientLookupResult,
  ClientLookupSource,
} from "@/app/api/clients/[id]/lookup/route"

type Phase =
  | "hints"
  | "searching"
  | "select-candidate"
  | "edit"
  | "saving"
  | "no-results"

/** The five writable fields, used for both the hints form and the draft. */
type FieldKey = "name" | "email" | "phone" | "address" | "webUrl"
type Fields = Record<FieldKey, string>

const FIELD_KEYS: FieldKey[] = ["name", "email", "phone", "address", "webUrl"]

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

function fieldsFromClient(client: ClientRow): Fields {
  return {
    name: client.name,
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    webUrl: client.webUrl ?? "",
  }
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
  const [phase, setPhase] = useState<Phase>("hints")
  const [result, setResult] = useState<ClientLookupResult | null>(null)
  const [chosen, setChosen] = useState<ClientLookupCandidate | null>(null)
  // Search parameters the operator types BEFORE the search. Prefilled from the
  // stored record; anything they change becomes an authoritative constraint for
  // the model (see ClientLookupHints on the server).
  const [hints, setHints] = useState<Fields>(() => fieldsFromClient(client))
  // Fields the operator typed by hand for the search that produced `result`.
  // Their values survive the merge — the point of typing them is that the user
  // knows better than the web.
  const [pinned, setPinned] = useState<Set<FieldKey>>(new Set())
  // Edit-form state — mirrors the writable client.* fields.
  const [draft, setDraft] = useState<Fields>(() => fieldsFromClient(client))

  const reset = useCallback(() => {
    setPhase("hints")
    setResult(null)
    setChosen(null)
    setPinned(new Set())
    setHints(fieldsFromClient(client))
    setDraft(fieldsFromClient(client))
  }, [client])

  // Merge a candidate into the draft. A field the operator pinned keeps their
  // value; everything else takes the found value, falling back to what the
  // search started from.
  const applyCandidate = useCallback(
    (cand: ClientLookupCandidate, base: Fields, keep: Set<FieldKey>) => {
      setChosen(cand)
      const next = {} as Fields
      for (const key of FIELD_KEYS) {
        next[key] = keep.has(key) ? base[key] : cand[key] || base[key]
      }
      setDraft(next)
    },
    [],
  )

  // Run the lookup with the given parameters. `params` is what the operator
  // typed (the hints form, or the current draft on a re-search).
  const runLookup = useCallback(
    async (params: Fields) => {
      const stored = fieldsFromClient(client)
      const typed = new Set<FieldKey>(
        FIELD_KEYS.filter(
          (k) => params[k].trim() && params[k].trim() !== stored[k].trim(),
        ),
      )
      setPinned(typed)
      setPhase("searching")
      try {
        const body: { hints: ClientLookupHints } = {
          hints: {
            name: params.name.trim(),
            email: params.email.trim(),
            phone: params.phone.trim(),
            address: params.address.trim(),
            webUrl: params.webUrl.trim(),
          },
        }
        const res = await fetch(`/api/clients/${client.id}/lookup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
          applyCandidate(r.candidates[0], params, typed)
          setPhase("edit")
        } else {
          setPhase("select-candidate")
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Не удалось выполнить поиск",
        )
        setPhase("hints")
      }
    },
    [client, applyCandidate],
  )

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      // No auto-search: the operator sets the parameters first.
      if (!next) reset()
    },
    [reset],
  )

  const pickCandidate = useCallback(
    (cand: ClientLookupCandidate) => {
      applyCandidate(cand, hints, pinned)
      setPhase("edit")
    },
    [applyCandidate, hints, pinned],
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
            Укажите, что вы уже знаете о компании — поиск использует это как
            обязательные условия. Результат можно проверить и отредактировать
            перед сохранением.
          </DialogDescription>
        </DialogHeader>

        {phase === "hints" && (
          <HintsView
            hints={hints}
            setHints={setHints}
            onSearch={() => runLookup(hints)}
            onCancel={() => handleOpenChange(false)}
          />
        )}

        {phase === "searching" && (
          <CenterMessage>
            <Loader className="h-6 w-6 animate-spin" />
            <span className="text-sm text-muted-foreground">
              Поиск в интернете: {hints.name || client.name}…
            </span>
          </CenterMessage>
        )}

        {phase === "no-results" && (
          <CenterMessage>
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            <div className="text-sm text-center text-muted-foreground max-w-md">
              Совпадений не найдено. Уточните параметры поиска и попробуйте
              снова.
            </div>
            <Button variant="outline" onClick={() => setPhase("hints")}>
              Изменить параметры
            </Button>
          </CenterMessage>
        )}

        {phase === "select-candidate" && result && (
          <CandidateSelector
            candidates={result.candidates}
            sources={result.sources}
            notes={result.notes}
            onPick={pickCandidate}
            onBackToHints={() => setPhase("hints")}
          />
        )}

        {(phase === "edit" || phase === "saving") && chosen && result && (
          <EditView
            currentClient={client}
            chosen={chosen}
            draft={draft}
            setDraft={setDraft}
            pinned={pinned}
            sources={result.sources}
            notes={result.notes}
            saving={phase === "saving"}
            onSave={save}
            onSearchAgain={() => runLookup(draft)}
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

function HintsView({
  hints,
  setHints,
  onSearch,
  onCancel,
}: {
  hints: Fields
  setHints: React.Dispatch<React.SetStateAction<Fields>>
  onSearch: () => void
  onCancel: () => void
}) {
  const set = (key: FieldKey) => (v: string) =>
    setHints((h) => ({ ...h, [key]: v }))

  return (
    <>
      <div className="text-xs text-muted-foreground border-b pb-2">
        Сайт — самое сильное условие: он задаёт компанию однозначно, и поиск не
        предложит однофамильцев в другой стране. Город или адрес отсекает
        компании из другого региона.
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 -mx-1 px-1">
        <FieldRow
          label="Название"
          value={hints.name}
          onChange={set("name")}
          changed={false}
        />
        <FieldRow
          label="Сайт"
          value={hints.webUrl}
          onChange={set("webUrl")}
          changed={false}
          placeholder="example.com"
        />
        <FieldRow
          label="Город / адрес"
          value={hints.address}
          onChange={set("address")}
          changed={false}
          placeholder="Москва"
        />
        <FieldRow
          label="Телефон"
          value={hints.phone}
          onChange={set("phone")}
          changed={false}
          placeholder="+7 495 123 4567"
        />
        <FieldRow
          label="Email"
          value={hints.email}
          onChange={set("email")}
          changed={false}
          placeholder="info@example.com"
        />
      </div>

      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button onClick={onSearch} disabled={!hints.name.trim()}>
          <Search className="h-4 w-4 mr-1" />
          Искать
        </Button>
      </DialogFooter>
    </>
  )
}

function CandidateSelector({
  candidates,
  sources,
  notes,
  onPick,
  onBackToHints,
}: {
  candidates: ClientLookupCandidate[]
  sources: ClientLookupSource[]
  notes: string
  onPick: (c: ClientLookupCandidate) => void
  onBackToHints: () => void
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
        <Button variant="ghost" onClick={onBackToHints}>
          Ни одно из них — уточнить параметры
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
  pinned,
  sources,
  notes,
  saving,
  onSave,
  onSearchAgain,
  onBack,
  onCancel,
}: {
  currentClient: ClientRow
  chosen: ClientLookupCandidate
  draft: Fields
  setDraft: React.Dispatch<React.SetStateAction<Fields>>
  pinned: Set<FieldKey>
  sources: ClientLookupSource[]
  notes: string
  saving: boolean
  onSave: () => void
  onSearchAgain: () => void
  onBack: (() => void) | null
  onCancel: () => void
}) {
  // Compute "changed" per field by comparing draft to the original client.
  const isChanged = useCallback(
    (field: FieldKey) => {
      const current = (currentClient[field] ?? "").trim()
      const next = draft[field].trim()
      return current !== next
    },
    [currentClient, draft],
  )

  // What the search found for a field the operator pinned — shown as an
  // offer, never applied silently over their own value.
  const suggestion = useCallback(
    (field: FieldKey) => {
      if (!pinned.has(field)) return ""
      const found = (chosen[field] ?? "").trim()
      return found && found !== draft[field].trim() ? found : ""
    },
    [chosen, draft, pinned],
  )

  const apply = (field: FieldKey, value: string) =>
    setDraft((d) => ({ ...d, [field]: value }))

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
          onChange={(v) => apply("name", v)}
          changed={isChanged("name")}
          suggestion={suggestion("name")}
          onApplySuggestion={(v) => apply("name", v)}
        />
        <FieldRow
          label="Email"
          value={draft.email}
          onChange={(v) => apply("email", v)}
          changed={isChanged("email")}
          placeholder="info@example.com"
          suggestion={suggestion("email")}
          onApplySuggestion={(v) => apply("email", v)}
        />
        <FieldRow
          label="Телефон"
          value={draft.phone}
          onChange={(v) => apply("phone", v)}
          changed={isChanged("phone")}
          placeholder="+7 495 123 4567"
          suggestion={suggestion("phone")}
          onApplySuggestion={(v) => apply("phone", v)}
        />
        <FieldRow
          label="Адрес"
          value={draft.address}
          onChange={(v) => apply("address", v)}
          changed={isChanged("address")}
          placeholder="Улица, город, страна"
          suggestion={suggestion("address")}
          onApplySuggestion={(v) => apply("address", v)}
        />
        <FieldRow
          label="Сайт"
          value={draft.webUrl}
          onChange={(v) => apply("webUrl", v)}
          changed={isChanged("webUrl")}
          placeholder="https://example.com"
          suggestion={suggestion("webUrl")}
          onApplySuggestion={(v) => apply("webUrl", v)}
        />
      </div>

      <SourcesBlock sources={sources} />

      <DialogFooter className="gap-2 sm:justify-between">
        <Button variant="outline" onClick={onSearchAgain} disabled={saving}>
          <RotateCw className="h-4 w-4 mr-1" />
          Искать снова с этими данными
        </Button>
        <div className="flex gap-2">
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
        </div>
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
  suggestion,
  onApplySuggestion,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  changed: boolean
  placeholder?: string
  suggestion?: string
  onApplySuggestion?: (v: string) => void
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
      {suggestion && onApplySuggestion && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">Найдено: {suggestion}</span>
          <button
            type="button"
            className="text-blue-600 dark:text-blue-400 hover:underline shrink-0"
            onClick={() => onApplySuggestion(suggestion)}
          >
            применить
          </button>
        </div>
      )}
    </div>
  )
}

// Gemini's grounded search returns redirect URLs whose host is the same for
// every source, so the publisher only exists in the title. Show that instead —
// otherwise the whole list reads "vertexaisearch.cloud.google.com".
const REDIRECT_HOSTS = ["vertexaisearch.cloud.google.com", "googleusercontent.com"]

function sourceLabel(s: ClientLookupSource): string {
  try {
    const host = new URL(s.url).host
    if (REDIRECT_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
      return s.title || host
    }
    return host
  } catch {
    return s.title || s.url
  }
}

function SourcesBlock({ sources }: { sources: ClientLookupSource[] }) {
  const [expanded, setExpanded] = useState(false)

  // Cap the visible list to keep the modal compact; "show more" reveals
  // the rest. Publishers are deduped so the UI doesn't repeat "linkedin.com"
  // 5 times.
  const deduped = useMemo(() => {
    const seen = new Set<string>()
    const out: { source: ClientLookupSource; label: string }[] = []
    for (const s of sources) {
      const label = sourceLabel(s)
      if (seen.has(label)) continue
      seen.add(label)
      out.push({ source: s, label })
    }
    return out
  }, [sources])

  if (sources.length === 0) return null

  const visible = expanded ? deduped : deduped.slice(0, 4)

  return (
    <div className="border-t pt-2 space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        Источники
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {visible.map(({ source, label }, i) => (
          <a
            key={i}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
            title={source.title}
          >
            {label}
            <ExternalLink className="h-3 w-3" />
          </a>
        ))}
        {deduped.length > 4 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs text-muted-foreground hover:underline"
          >
            +{deduped.length - 4} ещё
          </button>
        )}
      </div>
    </div>
  )
}
