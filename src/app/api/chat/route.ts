import {
  convertToModelMessages,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  tool,
  UIMessage,
} from "ai"
import { z } from "zod"
import { pipeJsonRender } from "@json-render/core"
import { buildSystemPrompt } from "@/lib/chat-prompt"
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
import { searchWeb } from "@/server/web-search"
import { DEFAULT_MODEL_KEY, getGatewayId } from "@/lib/llm-models"
import {
  entitySearchScore,
  FIELD_WEIGHT,
  FUZZY_THRESHOLD,
} from "@/lib/entity-search"

export const maxDuration = 120

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

// The web half of the engine. `searchWeb` runs its own grounded Gemini
// sub-call (see src/server/web-search.ts for why Google's `google_search`
// can't just be passed through to the chat model) so it is provider-agnostic
// and always registered — no session or org needed to read the public web.
const webTools = {
  searchWeb: tool({
    description:
      "Search the public internet and return grounded findings plus the source URLs consulted. Use it for anything the user's own records can't answer — what a company does, who its people are, market/news context, public contact details. Always use it before stating a fact about a named real-world company, person, product or event.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          "What to look up, as a self-contained search query (include the company/person name — this tool sees no chat history).",
        ),
    }),
    execute: async ({ query }) => searchWeb(query),
  }),
} as const

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

        // Matching goes through `entitySearchScore` — the same normalisation
        // pipeline Search V2 applies to products (Cyrillic→Latin translit,
        // accent-fold, punctuation-insensitive, token-OR, pg_trgm fuzzy gate
        // at FUZZY_THRESHOLD). The old raw `name.toLowerCase().includes(q)`
        // scored 0 whenever the model rephrased the name even slightly —
        // «АСТ» never found the stored «AST», and an em-dash query never
        // found an en-dash name. Results are RANKED so the best match leads.
        //
        // Soft-deleted (`deleted` status) entities are test artifacts /
        // mistakes — hidden from every CRM list by default. They must never
        // surface in search, and a deleted client must not pull in its
        // contacts/deals either (so the deleted-id set is excluded before
        // matchedClientIds is built).
        const rank = <T>(rows: { row: T; score: number }[]) =>
          rows
            .filter((r) => r.score >= FUZZY_THRESHOLD)
            .sort((a, b) => b.score - a.score)
            .map((r) => r.row)

        const matchedClients = rank(
          allClients
            .filter((c) => c.status !== "deleted")
            .map((c) => ({
              row: c,
              score: entitySearchScore(query, [
                { value: c.name, weight: FIELD_WEIGHT.name },
                { value: c.namePhys, weight: FIELD_WEIGHT.alias },
                ...(c.aliases ?? []).map((a) => ({
                  value: a,
                  weight: FIELD_WEIGHT.alias,
                })),
                { value: c.webUrl, weight: FIELD_WEIGHT.secondary },
                { value: c.email, weight: FIELD_WEIGHT.secondary },
              ]),
            })),
        )
        const matchedClientIds = new Set(matchedClients.map((c) => c.id))

        // Contacts: own-name match (technical, native or alias, plus email —
        // an operator often pastes an address) OR belonging to a matched
        // client.
        const matchedContacts = rank(
          allContacts
            .filter((c) => c.status !== "deleted")
            .map((c) => ({
              row: c,
              score:
                c.clientId !== null && matchedClientIds.has(c.clientId)
                  ? 1
                  : entitySearchScore(query, [
                      { value: c.name, weight: FIELD_WEIGHT.name },
                      { value: c.nameNative, weight: FIELD_WEIGHT.name },
                      ...(c.aliases ?? []).map((a) => ({
                        value: a,
                        weight: FIELD_WEIGHT.alias,
                      })),
                      { value: c.email, weight: FIELD_WEIGHT.secondary },
                    ]),
            })),
        )

        // Deals: own name / description match OR belonging to a matched
        // client. `listDeals` already drops `deleted`; the explicit guard
        // keeps it correct if the include flags ever change.
        const matchedDeals = rank(
          allDeals
            .filter((d) => d.status !== "deleted")
            .map((d) => ({
              row: d,
              score: matchedClientIds.has(d.clientId)
                ? 1
                : entitySearchScore(query, [
                    { value: d.name, weight: FIELD_WEIGHT.name },
                    { value: d.clientName, weight: FIELD_WEIGHT.secondary },
                    { value: d.description, weight: FIELD_WEIGHT.weak },
                  ]),
            })),
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
      model: modelKey = DEFAULT_MODEL_KEY,
    }: {
      messages: UIMessage[]
      model?: string
    } = await req.json()

    const gatewayId = getGatewayId(modelKey)

    // ── One universal search engine ───────────────────────────────────
    //
    // There used to be two mutually exclusive toggles ("внутренние
    // источники" / "веб-поиск"), because Google's built-in google_search
    // tool and custom function tools don't coexist on Gemini. Web search is
    // now an ordinary function tool of our own (`searchWeb`), so that
    // conflict is gone: every request gets whichever tools the caller is
    // actually entitled to, and the model picks.
    //
    // Internal tools require an authenticated session AND an active
    // organization — items are tenant-scoped, so without an active org
    // there's nothing to search. Anonymous or org-less callers get the
    // web-only engine.
    const session = await getServerSession()
    const sourceOrgId = session?.session.activeOrganizationId ?? null
    const sourceTools = buildSourceTools(sourceOrgId)

    // Web search needs neither a session nor an org, and every provider can
    // call it (it's an ordinary function tool), so it's always on.
    const tools = {
      ...webTools,
      ...(sourceTools ?? {}),
    }
    const hasTools = Object.keys(tools).length > 0

    console.log(
      "[chat] gateway:",
      gatewayId,
      "org:",
      sourceOrgId ?? "-",
      "tools:",
      Object.keys(tools),
    )

    const result = streamText({
      model: gatewayId,
      system: buildSystemPrompt({
        internal: sourceTools !== undefined,
        web: true,
      }),
      messages: await convertToModelMessages(messages),
      ...(hasTools ? { tools } : {}),
      // Bound the tool-call loop so the model can't spiral. A combined
      // question is the longest chain: searchEverything →
      // getSourceItemContent ×N → google_search → answer.
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
