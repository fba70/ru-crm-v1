import "server-only"
import { generateText, Output } from "ai"
import { z } from "zod"
import { getChatClient, listChatMembers } from "@/lib/google-chat"
import type { GchatCredentials } from "@/server/providers/handlers"
import { PARSER_CONFIG } from "@/lib/parser-config"
import {
  assembleMarkdown,
  buildFrontmatter,
  DEFAULT_RELEVANCE,
  extractUrls,
  uniqueStrings,
  type MetadataAnalysis,
  type SourceFrontmatter,
} from "@/server/parsers/_shared"

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
  contentMarkdown: z
    .string()
    .describe(
      "The full message body converted to clean, readable Markdown. Google Chat messages are plain text — preserve paragraph breaks, bullet-like patterns, code blocks wrapped in backticks, and quoted text. Do NOT include the frontmatter or a '## Content' heading — only the body content itself.",
    ),
})

export type ChatAttachmentRef = {
  /** Index within the parent message — used for source_id namespacing. */
  index: number
  /** Google Chat attachment resourceName (needed to download bytes). */
  resourceName: string
  filename: string
  contentType: string
}

export type ParsedChatMessage = {
  markdown: string
  metadata: {
    sourceId: string
    threadId: string | null
    sourceSystem: string
    author: string
  }
  attachments: ChatAttachmentRef[]
  /** Full Google Chat resource path: `spaces/X/messages/Y`. */
  messageName: string
  /** Short message ID (last segment of `messageName`). */
  messageId: string
  spaceName: string
  threadId: string | null
  sourceCreatedAt: string | null
  analysis: MetadataAnalysis
}

/**
 * Parse a single Google Chat message into a structured markdown document
 * matching refs/parsing-sources-template.md.
 *
 * Deterministic fields (thread_id, dates, sender, urls) come straight from
 * the Chat API payload. Recipients are fetched best-effort via
 * `listChatMembers` — if the DWD scope for memberships isn't authorised
 * yet, recipients will be empty rather than error.
 *
 * Content-derived fields (summary, mentions, companies, products, language,
 * clean markdown body) are produced by the LLM via generateText +
 * Output.object().
 */
export async function parseChatMessage(
  messageName: string,
  creds: GchatCredentials,
): Promise<ParsedChatMessage> {
  if (!/^spaces\/[^/]+\/messages\/[^/]+$/.test(messageName)) {
    throw new Error(
      `Invalid Google Chat messageName: expected "spaces/<id>/messages/<id>", got "${messageName}"`,
    )
  }

  const chat = getChatClient(creds)
  const { data: msg } = await chat.spaces.messages.get({ name: messageName })

  const spaceName = messageName.split("/").slice(0, 2).join("/") // "spaces/X"
  const messageId = messageName.split("/").pop() || ""

  const bodyText = msg.text ?? ""
  const author = msg.sender?.displayName?.trim() || "Unknown"
  const threadLastSegment = msg.thread?.name?.split("/").pop() ?? null

  // senders = the single message author; recipients = best-effort channel members.
  const senders = uniqueStrings([author])
  const memberNames = await listChatMembers(creds, spaceName)
  // Exclude the sender from recipients — they're already listed as a sender.
  const recipients = uniqueStrings(memberNames.filter((n) => n !== author))

  const bodyUrls = extractUrls(bodyText)
  const urls = uniqueStrings(bodyUrls)

  const sourceCreatedAt = msg.createTime
    ? new Date(msg.createTime).toISOString()
    : null
  const nowIso = new Date().toISOString()

  const { output: analysis } = await generateText({
    model: PARSER_CONFIG.text.model,
    output: Output.object({ schema: analysisSchema }),
    system:
      "You are a precise Google Chat message parsing assistant. Extract structured metadata and convert the message into clean markdown. Never fabricate facts — only return what is present in the message.",
    prompt: buildLlmPrompt({ author, recipients, bodyText }),
  })

  const sourceId = `gchat:${messageId}`
  const frontmatter: SourceFrontmatter = {
    sourceId,
    parentSourceId: null,
    threadId: threadLastSegment,
    sourceSystem: "Google Chat",
    sourceCreatedAt,
    sourceReceivedAt: sourceCreatedAt,
    processedAt: nowIso,
    language: analysis.language || "en",
    senders,
    recipients,
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

  const attachments: ChatAttachmentRef[] = (msg.attachment ?? [])
    .map((a, i) => {
      const resourceName = a.attachmentDataRef?.resourceName
      if (!resourceName) return null
      return {
        index: i,
        resourceName,
        filename: a.contentName ?? `attachment-${i + 1}`,
        contentType: a.contentType ?? "application/octet-stream",
      } as ChatAttachmentRef
    })
    .filter((a): a is ChatAttachmentRef => a !== null)

  return {
    markdown,
    metadata: {
      sourceId,
      threadId: threadLastSegment,
      sourceSystem: "Google Chat",
      author,
    },
    attachments,
    messageName,
    messageId,
    spaceName,
    threadId: threadLastSegment,
    sourceCreatedAt,
    analysis: {
      language: analysis.language || "en",
      summary: analysis.summary,
      mentions: uniqueStrings(analysis.mentions),
      companies: uniqueStrings(analysis.companies),
      products: uniqueStrings(analysis.products),
      relevance: DEFAULT_RELEVANCE,
    },
  }
}

function buildLlmPrompt(args: {
  author: string
  recipients: string[]
  bodyText: string
}): string {
  const { author, recipients, bodyText } = args
  const truncated =
    bodyText.length > 60_000
      ? `${bodyText.slice(0, 60_000)}\n\n[...truncated, ${bodyText.length - 60_000} additional characters omitted]`
      : bodyText

  return [
    `Source: Google Chat space message`,
    `Author: ${author}`,
    `Channel members: ${recipients.length > 0 ? recipients.join(", ") : "(unknown)"}`,
    "",
    "--- BEGIN MESSAGE BODY ---",
    truncated || "(empty message)",
    "--- END MESSAGE BODY ---",
  ].join("\n")
}
