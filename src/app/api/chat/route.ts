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
} from "@/server/source-items"
import { getGatewayId, getModel } from "@/lib/llm-models"

export const maxDuration = 60

const SYSTEM_PROMPT = `You are a helpful AI assistant for the Truffalo platform. You provide clear, accurate, and concise answers. You can help with general questions, analysis, writing, coding, and more.

${catalog.prompt({ mode: "inline" })}

## Additional display guidelines

- For small results (key-value pairs, 1-3 metrics, tiny tables <5 rows), render inline.
- For charts, large tables (>8 rows), complex JSON, or code files (>30 lines), use displayMode "panel".
- Always explain what the data shows in conversational text, then render the visualization.
- When producing charts, provide real/computed data — never use placeholder values.

## Internal sources tools (when enabled)

When the \`searchSourceItems\` and \`getSourceItemContent\` tools are available, the user has opted in to searching their stored, parsed sources (emails, chats, drive files, dropped files). Use them like this:

1. Start with \`searchSourceItems\` using a free-text query derived from the user's question. Returns brief hits (id, source, filename/subject, snippet, date) — pick the most relevant 1–3 ids.
2. Call \`getSourceItemContent\` for each picked id to read the full parsed markdown. Use this to answer detailed questions and to ground your reasoning in real content. Quote sparingly; prefer short, faithful summaries.
3. The user sees the matched sources rendered as cards directly in the chat — they can open the full content themselves via per-card buttons. **Do not** emit json-render specs to display source bodies; just write your prose answer.
4. If the search returns zero hits, tell the user plainly. Do not invent content.
5. Never expose source ids in the user-facing answer — they are internal.`

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
function buildSourceTools(organizationId: string | null) {
  if (!organizationId) return undefined
  return {
    searchSourceItems: tool({
      description:
        "Search the user's parsed sources (emails, chats, drive files, dropped files) belonging to their organization, by free-text query. Matches against filename and the source's metadata JSON (subjects, snippets, authors). Returns brief hits — call getSourceItemContent on a result's `id` to read the full body.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Free-text search query (matched ILIKE on filename + metadata)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(8)
          .describe("Max number of hits to return (1-20)."),
        dateFrom: z
          .iso
          .datetime()
          .optional()
          .describe("Inclusive lower bound on sourceCreatedAt (ISO 8601)."),
        dateTo: z
          .iso
          .datetime()
          .optional()
          .describe("Inclusive upper bound on sourceCreatedAt (ISO 8601)."),
      }),
      execute: async ({ query, limit, dateFrom, dateTo }) => {
        const r = await listSourceItems({
          status: "processed",
          organizationId,
          q: query,
          limit,
          dateFrom: dateFrom ? new Date(dateFrom) : undefined,
          dateTo: dateTo ? new Date(dateTo) : undefined,
        })
        return {
          totalMatched: r.total,
          hits: r.rows.map((row) => {
            const md = (row.metadataJson ?? {}) as Record<string, unknown>
            const subject =
              typeof md.subject === "string" ? md.subject : null
            const snippet =
              typeof md.snippet === "string" ? md.snippet : null
            return {
              id: row.id,
              sourceName: row.sourceName,
              sourceProvider: row.sourceProvider,
              filename: row.filename,
              subject,
              snippet,
              sourceCreatedAt: row.sourceCreatedAt,
            }
          }),
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
      // Bound the search → fetch → answer loop so the model can't
      // spiral on tool calls. 5 steps is enough for "search → fetch
      // top 2 → display → answer" with headroom.
      stopWhen: stepCountIs(5),
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
