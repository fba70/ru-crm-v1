"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Eye, PanelRightOpen, Loader, FileSearch } from "lucide-react"
import { toast } from "sonner"
import { ParsedMarkdownDialog } from "@/components/blocks/parsed-markdown-dialog"
import { usePanelContext } from "@/lib/chat-panel-context"
import type { SourceProvider } from "@/db/schema"
import { getProvider } from "@/lib/sources/providers"

// Shape returned by the `searchSourceItems` tool — see `buildSourceTools`
// in `src/app/api/chat/route.ts`. Keeping this aligned with the tool's
// `execute` return type by structural compatibility (no shared TS type
// since the tool result is plumbed through ai-sdk's `output` field as
// `unknown`).
type Hit = {
  id: string
  sourceName: string
  sourceProvider: SourceProvider
  filename: string | null
  subject: string | null
  snippet: string | null
  // Present on the getXContent tool outputs (LLM-extracted 1-3 sentence
  // summary); absent on searchSourceItems hits. Used as a snippet fallback.
  summary?: string | null
  sourceCreatedAt: string | null
}

type SearchOutput = {
  totalMatched: number
  hits: Hit[]
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

// Picks the most informative title for a card. Mirrors the row-title
// logic the source-items tables use, but adapts to whatever fields the
// `searchSourceItems` tool actually populated for this row's provider.
function hitTitle(hit: Hit): string {
  if (hit.subject && hit.subject.trim()) return hit.subject
  if (hit.filename && hit.filename.trim()) return hit.filename
  if (hit.snippet && hit.snippet.trim()) return hit.snippet
  if (hit.summary && hit.summary.trim()) return hit.summary
  return "(без названия)"
}

// Secondary line under the title: prefer the raw snippet, fall back to the
// LLM summary (present on getXContent hits, where snippet is often null).
function hitSnippet(hit: Hit): string | null {
  if (hit.snippet && hit.snippet.trim()) return hit.snippet
  if (hit.summary && hit.summary.trim()) return hit.summary
  return null
}

// Sole renderer for the `searchSourceItems` tool output in the chat.
// Replaces the generic <Tool>/<ToolHeader>/<ToolInput>/<ToolOutput>
// stack with a compact "Found Source(s)" section: one card per hit,
// each card carrying the metadata the user actually wants + two
// buttons (Preview = modal, Open in panel = right-side panel).
//
// The complementary `getSourceItemContent` tool stays registered so
// the model can still read content for grounding its answer, but its
// tool calls are hidden from the chat — the user opens content via
// the buttons here, not via a second tool render.
export function FoundSourcesCard({
  state,
  output,
  errorText,
}: {
  state: string
  output: unknown
  errorText: string | undefined
}) {
  const isLoading = state === "input-streaming" || state === "input-available"

  if (isLoading) {
    return (
      <div className="rounded-md border bg-card mb-4 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader className="h-4 w-4 animate-spin" />
        Поиск по источникам организации…
      </div>
    )
  }

  if (state === "output-error" || errorText) {
    return (
      <div className="rounded-md border bg-destructive/10 text-destructive mb-4 p-3 text-sm">
        Не удалось выполнить поиск по источникам{errorText ? `: ${errorText}` : "."}
      </div>
    )
  }

  if (state !== "output-available") return null

  const result = output as SearchOutput | undefined
  const hits = result?.hits ?? []

  return (
    <div className="rounded-md border bg-card mb-4 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <FileSearch className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {hits.length === 1 ? "Найден источник" : "Найдены источники"}
        </span>
        <span className="text-xs text-muted-foreground">
          {hits.length === 0
            ? "нет совпадений"
            : `${hits.length}${
                result && result.totalMatched > hits.length
                  ? ` из ${result.totalMatched}`
                  : ""
              }`}
        </span>
      </div>

      {hits.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          Совпадений не найдено.
        </p>
      ) : (
        <div className="p-3 space-y-2">
          {hits.map((hit) => (
            <FoundSourceCardRow key={hit.id} hit={hit} />
          ))}
        </div>
      )}
    </div>
  )
}

// Single card for one hit. Lazy-fetches the markdown only when the
// user clicks one of the two buttons — keeps the search step cheap
// even when the model returns 8+ hits.
function FoundSourceCardRow({ hit }: { hit: Hit }) {
  const { openPanel } = usePanelContext()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [panelLoading, setPanelLoading] = useState(false)

  const date = formatDate(hit.sourceCreatedAt)
  const providerMeta = getProvider(hit.sourceProvider)
  const ProviderIcon = providerMeta.icon
  const title = hitTitle(hit)
  const snippet = hitSnippet(hit)

  // Fetches the markdown via the org-scoped /markdown route, wraps it
  // in a single-element json-render spec, and pushes it to the right-
  // side panel. The dashboard already renders specs through Renderer +
  // JSONUIProvider, so the markdown lands in the same chrome as any
  // other panel content (Source / Rendered tabs).
  async function openInPanel() {
    setPanelLoading(true)
    try {
      const res = await fetch(`/api/sources/items/${hit.id}/markdown`)
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Не удалось загрузить документ")
      }
      const spec = {
        root: "root",
        elements: {
          root: {
            type: "Markdown",
            props: {
              content: data.markdown as string,
              displayMode: "inline",
            },
          },
        },
      }
      openPanel({
        spec,
        messageId: `source:${hit.id}`,
        title,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Неизвестная ошибка")
    } finally {
      setPanelLoading(false)
    }
  }

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium">
              <ProviderIcon className="h-3 w-3" />
              {providerMeta.label}
            </span>
            {hit.sourceName && (
              <>
                <span>·</span>
                <span className="truncate">{hit.sourceName}</span>
              </>
            )}
            {date && (
              <>
                <span>·</span>
                <span>{date}</span>
              </>
            )}
          </div>
          <h4
            className="text-sm font-medium mt-1 truncate"
            title={title}
          >
            {title}
          </h4>
          {snippet && snippet !== title && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
              {snippet}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setPreviewOpen(true)}
        >
          <Eye className="h-3.5 w-3.5 mr-1" />
          Просмотр
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={openInPanel}
          disabled={panelLoading}
        >
          {panelLoading ? (
            <Loader className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <PanelRightOpen className="h-3.5 w-3.5 mr-1" />
          )}
          Открыть в панели
        </Button>
      </div>

      <ParsedMarkdownDialog
        itemId={previewOpen ? hit.id : null}
        title={title}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  )
}
