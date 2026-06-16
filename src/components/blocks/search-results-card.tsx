"use client"

import { useState } from "react"
import {
  Building2,
  User,
  Handshake,
  FileSearch,
  Loader,
  PanelRightOpen,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { usePanelContext } from "@/lib/chat-panel-context"
import { dealStageLabel } from "@/lib/deal-funnel"
import { getProvider } from "@/lib/sources/providers"
import type { SourceProvider } from "@/db/schema"

// Renders the output of the `searchEverything` chat tool as a search-results
// view: a deterministic count header, then up to four sections (Clients /
// Contacts / Deals / Sources). Each result card carries ONE button that opens
// the full detail in the right-side panel (entity info or source markdown,
// formatted as Markdown via the json-render registry — same chrome the rest
// of the panel uses). Mirrors the tool's `execute` return shape structurally
// (the result is plumbed through ai-sdk's `output` field as `unknown`).

type ClientHit = {
  id: string
  name: string
  funnelPhase?: string | null
  webUrl?: string | null
  email?: string | null
  status?: string | null
}
type ContactHit = {
  id: string
  name: string
  nameNative?: string | null
  email?: string | null
  clientName?: string | null
  status?: string | null
}
type DealHit = {
  id: string
  name: string
  funnelStageName?: string | null
  clientName?: string | null
  value?: string | null
  currency?: string | null
  status?: string | null
}
type SourceHit = {
  id: string
  sourceName: string
  sourceProvider: SourceProvider
  filename: string | null
  subject: string | null
  snippet: string | null
  summary?: string | null
  sourceCreatedAt: string | null
}

type SearchOutput = {
  query: string
  counts: { clients: number; contacts: number; deals: number; sources: number }
  clients: ClientHit[]
  contacts: ContactHit[]
  deals: DealHit[]
  sources: SourceHit[]
}

const PHASE_LABEL: Record<string, string> = {
  awareness: "Осведомлённость",
  interest: "Интерес",
  decision: "Решение",
  action: "Действие",
  retention: "Удержание",
}
const STATUS_LABEL: Record<string, string> = {
  active: "Активный",
  initial: "Новый",
  suspended: "Приостановлен",
  deleted: "Удалён",
  cancelled: "Отменён",
}

function label(map: Record<string, string>, v: string | null | undefined) {
  if (!v) return null
  return map[v] ?? v
}

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleString("ru-RU", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Wraps a markdown string in the single-element json-render spec the panel
// renders (the panel's Renderer handles Markdown via the shared registry).
function markdownSpec(content: string) {
  return {
    root: "root",
    elements: {
      root: {
        type: "Markdown",
        props: { content, displayMode: "inline" },
      },
    },
  }
}

// ── markdown builders for entity detail panels ──────────────────────────

function row(lbl: string, val: string | null | undefined): string | null {
  if (!val || !String(val).trim()) return null
  return `**${lbl}:** ${val}`
}

function buildClientMarkdown(c: ClientDetailResponse): string {
  const lines: string[] = [`# ${c.name}`, ""]
  const facts = [
    row("Статус", label(STATUS_LABEL, c.status)),
    row("Этап воронки", label(PHASE_LABEL, c.funnelPhase)),
    row("Физ. лицо", c.namePhys),
    row("Email", c.email),
    row("Телефон", c.phone),
    row("Адрес", c.address),
    row("Сайт", c.webUrl),
    row("Псевдонимы", c.aliases?.length ? c.aliases.join(", ") : null),
    row("Комментарий", c.comment),
  ].filter((x): x is string => x !== null)
  lines.push(facts.join("\n\n"))
  const contacts = c.contacts ?? []
  lines.push("", `## Контакты (${contacts.length})`, "")
  if (contacts.length === 0) {
    lines.push("_Нет связанных контактов._")
  } else {
    for (const ct of contacts) {
      const bits = [
        ct.position,
        ct.email,
        ct.phone,
        label(STATUS_LABEL, ct.status),
      ].filter((x): x is string => !!x && x.trim().length > 0)
      const native = ct.nameNative ? ` (${ct.nameNative})` : ""
      lines.push(
        `- **${ct.name}**${native}${bits.length ? ` — ${bits.join(" · ")}` : ""}`,
      )
    }
  }
  return lines.join("\n")
}

function buildContactMarkdown(c: ContactDetailResponse): string {
  const lines: string[] = [`# ${c.name}`, ""]
  const facts = [
    c.nameNative ? row("На родном языке", c.nameNative) : null,
    row("Статус", label(STATUS_LABEL, c.status)),
    row("Должность", c.position),
    row("Email", c.email),
    row("Телефон", c.phone),
    row("Клиент", c.clientName),
    row("Псевдонимы", c.aliases?.length ? c.aliases.join(", ") : null),
  ].filter((x): x is string => x !== null)
  lines.push(facts.join("\n\n"))
  return lines.join("\n")
}

function buildDealMarkdown(d: DealDetailResponse): string {
  const lines: string[] = [`# ${d.name}`, ""]
  const amount =
    d.value !== null && d.value !== undefined
      ? `${d.value} ${d.currency ?? ""}`.trim()
      : null
  const facts = [
    row("Статус", label(STATUS_LABEL, d.status)),
    row(
      "Этап воронки",
      d.funnelStageName ? dealStageLabel(d.funnelStageName) : null,
    ),
    row("Клиент", d.clientName),
    row("Сумма", amount),
  ].filter((x): x is string => x !== null)
  lines.push(facts.join("\n\n"))
  if (d.description?.trim()) {
    lines.push("", "## Описание", "", d.description)
  }
  if (d.reasoning?.trim()) {
    lines.push("", "## Обоснование", "", d.reasoning)
  }
  if (d.changes?.trim()) {
    lines.push("", "## Изменения", "", d.changes)
  }
  return lines.join("\n")
}

// Minimal shapes for the detail-fetch responses (the API returns the full
// server rows; we read only what the markdown builders use).
type ClientDetailResponse = {
  id: string
  name: string
  namePhys: string | null
  comment: string | null
  aliases: string[] | null
  phone: string | null
  email: string | null
  address: string | null
  webUrl: string | null
  funnelPhase: string
  status: string
  contacts: {
    name: string
    nameNative: string | null
    email: string | null
    phone: string | null
    position: string | null
    status: string
  }[]
}
type ContactDetailResponse = {
  id: string
  name: string
  nameNative: string | null
  aliases: string[] | null
  phone: string | null
  email: string | null
  position: string | null
  clientName: string | null
  status: string
}
type DealDetailResponse = {
  id: string
  name: string
  description: string | null
  reasoning: string | null
  changes: string | null
  funnelStageName: string | null
  clientName: string | null
  value: string | null
  currency: string | null
  status: string
}

// ── generic result card (icon + title + subtitle + single open button) ──

function ResultCard({
  icon: Icon,
  title,
  subtitle,
  onOpen,
}: {
  icon: LucideIcon
  title: string
  subtitle: string[]
  // Loads the detail and returns the panel content. Errors are toasted.
  onOpen: () => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  async function handle() {
    setLoading(true)
    try {
      await onOpen()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось открыть")
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="rounded-md border bg-muted/20 p-3 flex items-start gap-3">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-sm font-medium" title={title}>
          {title}
        </h4>
        {subtitle.length > 0 && (
          <p className="truncate text-xs text-muted-foreground mt-0.5">
            {subtitle.join(" · ")}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs shrink-0"
        onClick={handle}
        disabled={loading}
      >
        {loading ? (
          <Loader className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <PanelRightOpen className="h-3.5 w-3.5 mr-1" />
        )}
        Открыть
      </Button>
    </div>
  )
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon
  title: string
  count: number
  children: React.ReactNode
}) {
  if (count === 0) return null
  const Icon = icon
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

export function SearchResultsCard({
  state,
  output,
  errorText,
}: {
  state: string
  output: unknown
  errorText: string | undefined
}) {
  const { openPanel } = usePanelContext()

  const isLoading = state === "input-streaming" || state === "input-available"
  if (isLoading) {
    return (
      <div className="rounded-md border bg-card mb-4 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader className="h-4 w-4 animate-spin" />
        Поиск по CRM и источникам…
      </div>
    )
  }

  if (state === "output-error" || errorText) {
    return (
      <div className="rounded-md border bg-destructive/10 text-destructive mb-4 p-3 text-sm">
        Не удалось выполнить поиск{errorText ? `: ${errorText}` : "."}
      </div>
    )
  }

  if (state !== "output-available") return null

  const result = output as SearchOutput | undefined
  if (!result) return null
  const { counts, clients, contacts, deals, sources } = result
  const totalAll =
    counts.clients + counts.contacts + counts.deals + counts.sources

  // Opens an entity detail panel: fetch the full row, build markdown, push it.
  async function openEntity(
    kind: "clients" | "contacts" | "deals",
    id: string,
    title: string,
  ) {
    const res = await fetch(`/api/${kind}?id=${encodeURIComponent(id)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Не удалось загрузить")
    const content =
      kind === "clients"
        ? buildClientMarkdown(data.client as ClientDetailResponse)
        : kind === "contacts"
          ? buildContactMarkdown(data.contact as ContactDetailResponse)
          : buildDealMarkdown(data.deal as DealDetailResponse)
    openPanel({ spec: markdownSpec(content), messageId: `${kind}:${id}`, title })
  }

  async function openSource(hit: SourceHit, title: string) {
    const res = await fetch(`/api/sources/items/${hit.id}/markdown`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Не удалось загрузить документ")
    openPanel({
      spec: markdownSpec(data.markdown as string),
      messageId: `source:${hit.id}`,
      title,
    })
  }

  return (
    <div className="rounded-md border bg-card mb-4 overflow-hidden">
      {/* Count header — deterministic, built from the tool output. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b">
        <FileSearch className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Результаты поиска</span>
        {totalAll === 0 ? (
          <span className="text-xs text-muted-foreground">ничего не найдено</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {[
              counts.clients > 0 ? `клиентов: ${counts.clients}` : null,
              counts.contacts > 0 ? `контактов: ${counts.contacts}` : null,
              counts.deals > 0 ? `сделок: ${counts.deals}` : null,
              counts.sources > 0 ? `источников: ${counts.sources}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </div>

      {totalAll === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          Совпадений не найдено.
        </p>
      ) : (
        <div className="p-3 space-y-4">
          <Section icon={Building2} title="Клиенты" count={counts.clients}>
            {clients.map((c) => (
              <ResultCard
                key={c.id}
                icon={Building2}
                title={c.name}
                subtitle={[
                  label(PHASE_LABEL, c.funnelPhase),
                  c.webUrl,
                  c.email,
                ].filter((s): s is string => !!s && s.trim().length > 0)}
                onOpen={() => openEntity("clients", c.id, c.name)}
              />
            ))}
          </Section>

          <Section icon={User} title="Контакты" count={counts.contacts}>
            {contacts.map((c) => (
              <ResultCard
                key={c.id}
                icon={User}
                title={c.name}
                subtitle={[
                  c.nameNative,
                  c.clientName ? `в ${c.clientName}` : null,
                  c.email,
                ].filter((s): s is string => !!s && s.trim().length > 0)}
                onOpen={() => openEntity("contacts", c.id, c.name)}
              />
            ))}
          </Section>

          <Section icon={Handshake} title="Сделки" count={counts.deals}>
            {deals.map((d) => (
              <ResultCard
                key={d.id}
                icon={Handshake}
                title={d.name}
                subtitle={[
                  d.funnelStageName ? dealStageLabel(d.funnelStageName) : null,
                  d.clientName ? `клиент ${d.clientName}` : null,
                  d.value ? `${d.value} ${d.currency ?? ""}`.trim() : null,
                ].filter((s): s is string => !!s && s.trim().length > 0)}
                onOpen={() => openEntity("deals", d.id, d.name)}
              />
            ))}
          </Section>

          <Section icon={FileSearch} title="Источники" count={counts.sources}>
            {sources.map((hit) => {
              const providerMeta = getProvider(hit.sourceProvider)
              const title =
                hit.subject?.trim() ||
                hit.filename?.trim() ||
                hit.snippet?.trim() ||
                hit.summary?.trim() ||
                "(без названия)"
              const date = formatDate(hit.sourceCreatedAt)
              const subtitle = [
                providerMeta.label,
                hit.sourceName,
                date,
              ].filter((s): s is string => !!s && s.trim().length > 0)
              return (
                <ResultCard
                  key={hit.id}
                  icon={providerMeta.icon}
                  title={title}
                  subtitle={subtitle}
                  onOpen={() => openSource(hit, title)}
                />
              )
            })}
          </Section>
        </div>
      )}
    </div>
  )
}
