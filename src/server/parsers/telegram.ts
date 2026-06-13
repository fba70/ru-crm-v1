import "server-only"
import { generateText, Output } from "ai"
import { z } from "zod"
import { PARSER_CONFIG } from "@/lib/parser-config"
import {
  assembleMarkdown,
  buildFrontmatter,
  DEFAULT_RELEVANCE,
  extractUrls,
  filterMentionedPeople,
  MENTIONED_PEOPLE_PROMPT,
  mentionedPersonSchema,
  uniqueStrings,
  type MetadataAnalysis,
  type SourceFrontmatter,
} from "@/server/parsers/_shared"

// Telegram message parser. Like WhatsApp (and unlike gchat/nylas) there is
// NO remote API to re-fetch from — the message body was persisted in
// `metadata_json.rawText` at ingest time, so parse is purely a local
// render + one LLM metadata pass. Single message per row (Telegram DM),
// so the shape mirrors `parseChatMessage` more than the WhatsApp group
// parser.

const analysisSchema = z.object({
  language: z
    .string()
    .describe(
      "ISO 639-1 two-letter language code of the message (e.g. 'en', 'ru', 'de'). Default to 'en' if uncertain.",
    ),
  summary: z
    .string()
    .describe("A concise 1-3 sentence summary of what the message is about."),
  mentions: z
    .array(z.string())
    .describe(
      "Names of every person mentioned by name in the message body. Use the form they are addressed/signed as in the body.",
    ),
  companies: z
    .array(z.string())
    .describe("Names of companies or brands mentioned in the body."),
  products: z
    .array(z.string())
    .describe("Names of products mentioned in the body."),
  mentionedPeople: z
    .array(mentionedPersonSchema)
    .describe(
      "People mentioned in the message body beyond the sender (third parties referenced by name). See the system prompt for emission rules.",
    ),
  contentMarkdown: z
    .string()
    .describe(
      "The message body as clean, readable Markdown. Telegram messages are plain text (with light entity formatting) — preserve paragraph breaks, lists, links, and code. Do NOT include frontmatter or a '## Content' heading — only the body content itself.",
    ),
})

export type ParseTelegramMessageInput = {
  // The message body — exactly what ingest stamped into
  // `metadata_json.rawText`.
  rawText: string
  // Namespaced source id for the frontmatter (`telegram:<chat>:<msg>`).
  sourceId: string
  // Sender display name (from ingest's `metadata_json.senders[0]`).
  sender: string
  threadId: string | null
  // Provider-side timestamp (ISO) — the message's send time.
  sourceCreatedAt: string | null
}

export type ParsedTelegramMessage = {
  markdown: string
  analysis: MetadataAnalysis
}

export async function parseTelegramMessage(
  input: ParseTelegramMessageInput,
): Promise<ParsedTelegramMessage> {
  const { output: analysis } = await generateText({
    model: PARSER_CONFIG.text.model,
    output: Output.object({ schema: analysisSchema }),
    system: `You are a precise Telegram message parsing assistant. Extract structured metadata and convert the message into clean markdown. Never fabricate facts — only return what is present in the message.

${MENTIONED_PEOPLE_PROMPT}

For Telegram specifically: the 'author/sender' is the message sender shown above; don't include them in mentionedPeople. Only emit third parties referenced inside the message body. When inferring an organization from the sender's affiliation, only do so if the body text itself makes their company unambiguous (they introduce themselves with an affiliation, or quote a business email).`,
    prompt: buildLlmPrompt({ sender: input.sender, rawText: input.rawText }),
  })

  const urls = extractUrls(input.rawText)
  const nowIso = new Date().toISOString()
  const senders = uniqueStrings([input.sender])

  const frontmatter: SourceFrontmatter = {
    sourceId: input.sourceId,
    parentSourceId: null,
    threadId: input.threadId,
    sourceSystem: "Telegram",
    sourceCreatedAt: input.sourceCreatedAt,
    sourceReceivedAt: input.sourceCreatedAt,
    processedAt: nowIso,
    language: analysis.language || "en",
    senders,
    recipients: [],
    mentions: analysis.mentions,
    companies: analysis.companies,
    products: analysis.products,
    urls,
  }

  const markdown = assembleMarkdown(
    buildFrontmatter(frontmatter),
    analysis.summary,
    analysis.contentMarkdown,
  )

  return {
    markdown,
    analysis: {
      language: analysis.language || "en",
      summary: analysis.summary,
      mentions: uniqueStrings(analysis.mentions),
      companies: uniqueStrings(analysis.companies),
      products: uniqueStrings(analysis.products),
      relevance: DEFAULT_RELEVANCE,
      mentionedPeople: filterMentionedPeople(analysis.mentionedPeople ?? []),
    },
  }
}

function buildLlmPrompt(args: { sender: string; rawText: string }): string {
  const { sender, rawText } = args
  const truncated =
    rawText.length > 60_000
      ? `${rawText.slice(0, 60_000)}\n\n[...truncated, ${rawText.length - 60_000} additional characters omitted]`
      : rawText
  return [
    `Source: Telegram direct message`,
    `Sender: ${sender}`,
    "",
    "--- BEGIN MESSAGE BODY ---",
    truncated || "(empty message)",
    "--- END MESSAGE BODY ---",
  ].join("\n")
}
