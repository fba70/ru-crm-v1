import {
  convertToModelMessages,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  tool,
  UIMessage,
} from "ai"
import { google } from "@ai-sdk/google"
import { z } from "zod"
import { pipeJsonRender } from "@json-render/core"
import { catalog } from "@/lib/catalog"
import { getServerSession } from "@/lib/get-session"
import {
  getSourceItemMarkdown,
  listSourceItems,
  type SourceItemRow,
} from "@/server/source-items"
import { listClientContent } from "@/server/client-content"
import { listClients } from "@/server/clients"
import { listContacts } from "@/server/contacts"
import { listDeals } from "@/server/deals"
import { getGatewayId, getModel } from "@/lib/llm-models"

export const maxDuration = 120

const SYSTEM_PROMPT = `You are a helpful AI assistant for the Truffalo platform. You provide clear, accurate, and concise answers. You can help with general questions, analysis, writing, coding, and more.

${catalog.prompt({ mode: "inline" })}

## Additional display guidelines

- For small results (key-value pairs, 1-3 metrics, tiny tables <5 rows), render inline.
- For charts, large tables (>8 rows), complex JSON, or code files (>30 lines), use displayMode "panel".
- Always explain what the data shows in conversational text, then render the visualization.
- When producing charts, provide real/computed data — never use placeholder values.

## Internal search tool (when enabled)

When \`searchEverything\` is available, the user has opted in to searching their stored, parsed sources (emails, chats, drive files, dropped files) and CRM entities (clients, contacts, deals). This is a **single-turn** flow — do NOT ask the user to pick or disambiguate, and do NOT wait for a follow-up message.

**Steps:**
1. Call \`searchEverything\` ONCE with the user's query (a company/person/deal name, or any free-text topic). It returns matched \`clients\`, \`contacts\`, \`deals\` and \`sources\` plus \`counts\`. This is the whole result set — do not call it again for the same question.
2. If you want to ground the summary in real content, call \`getSourceItemContent\` on the 1–3 most relevant source ids from the result to read their full parsed markdown.
3. Write ONE concise summary that (a) names the subject of the search, (b) states what was found, referencing the counts naturally (e.g. "нашёл 1 клиента, 4 контакта и 13 источников"), and (c) gives a short, faithful synthesis grounded in the sources you read. If \`counts\` are all zero, say plainly that nothing was found — do not invent.

**Rules:**
- The user sees the matched clients / contacts / deals / sources rendered as cards directly below your summary — each with its own "open detail" button — plus a count header. **Do NOT** enumerate every entity or paste source bodies in your prose, and **do NOT** emit json-render specs; just write the summary. The cards handle browsing.
- Never expose source/entity ids in the user-facing answer — they are internal.`

// Model dictionary lives in src/lib/llm-models.ts so the chat picker, the
// Explore-sources dialog, and this route share one source of truth.
// All requests route through Vercel AI Gateway (auth via AI_GATEWAY_API_KEY).
// Plain "provider/model" strings passed to streamText() are auto-routed by AI SDK v6.

// Builds the source-search tool set. All three execute server-side and
// are scoped to the caller's active organization — listing only that
// org's items, and refusing to read markdown from rows owned by a
// different org. The chat route is technically public, so the tools
// are only registered when an authenticated session AND an active org
// are both present (enforced by the caller).
// Maps a relevance-matched source_item row to the compact hit shape the
// model reasons over (same shape `searchSourceItems` returns). The model
// reads full bodies via `getSourceItemContent` on a hit's `id`.
function toSourceHit(row: SourceItemRow) {
  const md = (row.metadataJson ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    sourceName: row.sourceName,
    sourceProvider: row.sourceProvider,
    filename: row.filename,
    subject: typeof md.subject === "string" ? md.subject : null,
    snippet: typeof md.snippet === "string" ? md.snippet : null,
    summary: typeof md.summary === "string" ? md.summary : null,
    sourceCreatedAt: row.sourceCreatedAt,
  }
}

function buildSourceTools(organizationId: string | null) {
  if (!organizationId) return undefined
  return {
    // ── Unified search (one call, all entity types + sources) ─────────
    // Resolves the user's query into matched clients / contacts / deals
    // and the relevant source items in a single pass, so the chat can
    // render a summary + sectioned result cards from one tool result.
    // The model calls this ONCE, then reads a few source bodies via
    // getSourceItemContent to ground its summary.
    searchEverything: tool({
      description:
        "Search the user's CRM + stored sources in ONE call. Pass the user's query (a company / person / deal name, or any free-text topic). Returns matched clients, contacts, deals and source items (emails, chats, files) plus counts. Call this ONCE per question. Then read the top 1-3 source bodies with getSourceItemContent to ground your summary. The user sees the results rendered as cards — do not enumerate them in prose.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("What to search for — an entity name or free-text topic."),
        dateFrom: z.iso
          .datetime()
          .optional()
          .describe("Inclusive lower bound on source date (ISO 8601)."),
        dateTo: z.iso
          .datetime()
          .optional()
          .describe("Inclusive upper bound on source date (ISO 8601)."),
      }),
      execute: async ({ query, dateFrom, dateTo }) => {
        const q = query.trim().toLowerCase()
        const from = dateFrom ? new Date(dateFrom) : undefined
        const to = dateTo ? new Date(dateTo) : undefined

        // Per-section cap. Plenty for a chat result; keeps payloads small.
        const ENTITY_CAP = 12
        const SOURCE_CAP = 15
        // How many matched clients we expand into curated content.
        const CONTENT_CLIENT_CAP = 5

        const [allClients, allContacts, allDeals] = await Promise.all([
          listClients(),
          listContacts(),
          listDeals({ includeCancelled: true }),
        ])

        // Soft-deleted (`deleted` status) entities are test artifacts /
        // mistakes — hidden from every CRM list by default. They must never
        // surface in search, and a deleted client must not pull in its
        // contacts/deals either (so the deleted-id set is excluded before
        // matchedClientIds is built).
        const matchedClients = allClients.filter(
          (c) => c.status !== "deleted" && c.name.toLowerCase().includes(q),
        )
        const matchedClientIds = new Set(matchedClients.map((c) => c.id))

        // Contacts: name/native-name match OR belonging to a matched client.
        const matchedContacts = allContacts.filter(
          (c) =>
            c.status !== "deleted" &&
            (c.name.toLowerCase().includes(q) ||
              (c.nameNative?.toLowerCase().includes(q) ?? false) ||
              (c.clientId !== null && matchedClientIds.has(c.clientId))),
        )

        // Deals: name match OR belonging to a matched client. `listDeals`
        // already drops `deleted`; the explicit guard keeps it correct if
        // the include flags ever change.
        const matchedDeals = allDeals.filter(
          (d) =>
            d.status !== "deleted" &&
            (d.name.toLowerCase().includes(q) ||
              matchedClientIds.has(d.clientId)),
        )

        // Sources: union of each matched client's curated content + a
        // free-text scan, deduped by id (curated hits win on collision).
        const sourceById = new Map<string, ReturnType<typeof toSourceHit>>()
        const clientContentResults = await Promise.all(
          matchedClients.slice(0, CONTENT_CLIENT_CAP).map((c) =>
            listClientContent({
              organizationId,
              clientId: c.id,
              limit: 8,
              dateFrom: from,
              dateTo: to,
            }).catch(() => ({ rows: [], total: 0, matchTerms: [] })),
          ),
        )
        for (const r of clientContentResults) {
          for (const row of r.rows) {
            if (!sourceById.has(row.id)) sourceById.set(row.id, toSourceHit(row))
          }
        }
        const freeText = await listSourceItems({
          status: "processed",
          organizationId,
          q: query,
          limit: SOURCE_CAP,
          dateFrom: from,
          dateTo: to,
        })
        for (const row of freeText.rows) {
          if (!sourceById.has(row.id)) sourceById.set(row.id, toSourceHit(row))
        }

        const clients = matchedClients.slice(0, ENTITY_CAP).map((c) => ({
          id: c.id,
          name: c.name,
          funnelPhase: c.funnelPhase,
          webUrl: c.webUrl,
          email: c.email,
          status: c.status,
        }))
        const contacts = matchedContacts.slice(0, ENTITY_CAP).map((c) => ({
          id: c.id,
          name: c.name,
          nameNative: c.nameNative,
          email: c.email,
          clientName: c.clientName,
          status: c.status,
        }))
        const deals = matchedDeals.slice(0, ENTITY_CAP).map((d) => ({
          id: d.id,
          name: d.name,
          funnelStageName: d.funnelStageName,
          clientName: d.clientName,
          value: d.value,
          currency: d.currency,
          status: d.status,
        }))
        const sources = Array.from(sourceById.values()).slice(0, SOURCE_CAP)

        return {
          query,
          counts: {
            clients: clients.length,
            contacts: contacts.length,
            deals: deals.length,
            sources: sources.length,
          },
          clients,
          contacts,
          deals,
          sources,
        }
      },
    }),
    getSourceItemContent: tool({
      description:
        "Fetch the full parsed markdown for one source item by its id (returned by searchSourceItems). Use this to read content for reasoning so you can ground your prose answer in the real source. The user sees the matched items as cards in the chat with their own preview buttons — you do not need to display the body yourself.",
      inputSchema: z.object({
        sourceItemId: z.string().describe("The source item id."),
      }),
      execute: async ({ sourceItemId }) => {
        const markdown = await getSourceItemMarkdown(sourceItemId, {
          requireOrganizationId: organizationId,
        })
        if (markdown === null) {
          return { ok: false as const, error: "Not parsed or not found." }
        }
        return { ok: true as const, sourceItemId, markdown }
      },
    }),
  } as const
}

export async function POST(req: Request) {
  try {
    const {
      messages,
      model: modelKey = "gpt-5-mini",
      enableSearch = false,
      enableSources = false,
    }: {
      messages: UIMessage[]
      model?: string
      enableSearch?: boolean
      enableSources?: boolean
    } = await req.json()

    // Mutually exclusive on Gemini: the built-in google_search tool is
    // known not to mix with custom function tools in the same call. The
    // client UI also enforces this, but guard server-side too in case
    // the request body comes from elsewhere (or stale state).
    const provider = getModel(modelKey)?.provider
    const sourcesActive = enableSources
    const searchActive = enableSearch && !sourcesActive

    console.log(
      "[chat] model:",
      modelKey,
      "search:",
      searchActive,
      "sources:",
      sourcesActive,
    )

    const gatewayId = getGatewayId(modelKey)

    // Source tools require an authenticated session AND an active
    // organization — items are tenant-scoped, so without an active org
    // there's nothing to search. Anonymous or org-less callers don't
    // see the tools even if enableSources=true is forged.
    const session = sourcesActive ? await getServerSession() : null
    const sourceOrgId =
      sourcesActive && session ? session.session.activeOrganizationId : null
    const sourceTools = buildSourceTools(sourceOrgId)

    // google_search is Gemini-only (it's Google's own grounding tool, not
    // a user-defined function). Custom source tools are provider-agnostic —
    // OpenAI, Google, and Anthropic all support tool calling natively, and
    // the AI SDK + Vercel AI Gateway translate the Zod-schema tool defs to
    // each provider's wire format.
    const builtinSearchTool =
      searchActive && provider === "google"
        ? { google_search: google.tools.googleSearch({}) }
        : undefined

    const tools = {
      ...(builtinSearchTool ?? {}),
      ...(sourceTools ?? {}),
    }
    const hasTools = Object.keys(tools).length > 0

    console.log(
      "[chat] gateway:",
      gatewayId,
      "provider:",
      provider,
      "tools:",
      Object.keys(tools),
    )

    const result = streamText({
      model: gatewayId,
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      ...(hasTools ? { tools } : {}),
      // Bound the tool-call loop so the model can't spiral. The entity
      // path is the longest chain: find → (disambiguate) → getEntityContent
      // → getSourceItemContent ×N → answer, so allow more headroom than the
      // old free-text-only flow.
      stopWhen: stepCountIs(10),
    })

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.merge(pipeJsonRender(result.toUIMessageStream()))
      },
    })

    return createUIMessageStreamResponse({ stream })
  } catch (error) {
    console.error("[chat] Error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
}
