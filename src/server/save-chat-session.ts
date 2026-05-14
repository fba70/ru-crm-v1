import "server-only"

import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { generateText, Output } from "ai"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { sourceItem } from "@/db/schema"
import { getOrCreateAiChatSource } from "@/server/sources"
import {
  assembleMarkdown,
  buildFrontmatter,
  DEFAULT_RELEVANCE,
  uniqueStrings,
  type MetadataAnalysis,
  type SourceFrontmatter,
} from "@/server/parsers/_shared"
import {
  parseDropoffFile,
  PdfTooLargeError,
  ImageTooLargeError,
  UnsupportedImageTypeError,
  AudioTooLargeError,
  UnsupportedAudioTypeError,
  VideoTooLargeError,
  UnsupportedVideoTypeError,
  OfficeTooLargeError,
  UnsupportedOfficeTypeError,
  UnsupportedDropoffTypeError,
} from "@/server/parsers/dropoff"

// ── Public types ─────────────────────────────────────────────────────

// Lean view of a chat message that the client extracts from the
// `useChat` UIMessage parts before sending. Tool calls / reasoning /
// json-render specs are intentionally dropped at the client side per
// Q4 (conversation-only). Files are sent as a separate multipart, NOT
// embedded here as data URLs (would balloon the JSON payload).
export type ChatMessageInput = {
  role: "user" | "assistant" | "system"
  /** Concatenated text from all text parts of the message, in order. */
  text: string
}

// One per file extracted from the message stream by the client. Server
// runs each through the dropoff parser to produce a child source_item.
export type ChatFileInput = {
  /** Original filename. */
  fileName: string
  /** Raw bytes — populated by the route after multipart parse. */
  bytes: Uint8Array
  /** Mime hint (browser-provided). May be "" for unknown. */
  mediaType: string
}

export type SaveChatSessionInput = {
  /** Active organization id for the caller. Sourced from the session. */
  organizationId: string
  /** ID of the user invoking the save — kept on the row for audit. */
  userId: string
  /** User-confirmed title from the modal — used as the row's filename. */
  title: string
  /** The conversation, in order. Must contain at least one message. */
  messages: ChatMessageInput[]
  /** Files extracted from the chat. May be empty. */
  files: ChatFileInput[]
}

export type SaveChatSessionResult = {
  itemId: string
  parentExternalId: string
  childInserted: number
  childSkipped: number
  childFailed: number
  perFileResults: {
    fileName: string
    ok: boolean
    error?: string
    reason?: string
  }[]
}

// ── Markdown rendering (conversation only — Q4) ──────────────────────

const ROLE_LABEL: Record<ChatMessageInput["role"], string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
}

function renderConversation(
  messages: ChatMessageInput[],
  files: ChatFileInput[],
): string {
  const lines: string[] = []
  for (const msg of messages) {
    const text = msg.text.trim()
    if (!text) continue
    lines.push(`### ${ROLE_LABEL[msg.role]}`)
    lines.push("")
    lines.push(text)
    lines.push("")
  }
  if (files.length > 0) {
    // Files section at the bottom — references by filename. Each file
    // also lands as its own child source_item; this list is just so
    // the conversation transcript remembers what was attached.
    lines.push("### Files attached")
    lines.push("")
    for (const f of files) {
      lines.push(`- \`${f.fileName}\``)
    }
    lines.push("")
  }
  return lines.join("\n").trim()
}

// ── Analysis (Gemini → metadata_json fields) ─────────────────────────

const analysisSchema = z.object({
  language: z
    .string()
    .describe(
      "ISO 639-1 two-letter language code of the dominant conversation language (e.g. 'en'). Default to 'en' if mixed or uncertain.",
    ),
  summary: z
    .string()
    .describe(
      "A concise 1-3 sentence summary of what this AI-chat session was about — the user's goals, key questions, what the assistant produced.",
    ),
  mentions: z
    .array(z.string())
    .describe(
      "Names of every person mentioned by name anywhere in the conversation. Includes the participants of the chat itself if they're named.",
    ),
  companies: z
    .array(z.string())
    .describe(
      "Names of companies or brands mentioned in the conversation.",
    ),
  products: z
    .array(z.string())
    .describe("Names of products mentioned in the conversation."),
})

const ANALYSIS_MODEL = "google/gemini-2.5-flash"

async function extractAnalysis(transcript: string): Promise<MetadataAnalysis> {
  const truncated =
    transcript.length > 60_000
      ? `${transcript.slice(0, 60_000)}\n\n[...truncated, ${transcript.length - 60_000} additional characters omitted]`
      : transcript

  const { output } = await generateText({
    model: ANALYSIS_MODEL,
    output: Output.object({ schema: analysisSchema }),
    system:
      "You are a precise AI-chat session analysis assistant. Extract structured metadata from a saved conversation between a user and an AI assistant. Never fabricate facts — only return what is present in the transcript.",
    prompt: [
      "--- BEGIN AI CHAT TRANSCRIPT ---",
      truncated || "(empty transcript)",
      "--- END AI CHAT TRANSCRIPT ---",
    ].join("\n"),
  })

  return {
    language: output.language || "en",
    summary: output.summary,
    mentions: uniqueStrings(output.mentions),
    companies: uniqueStrings(output.companies),
    products: uniqueStrings(output.products),
    relevance: DEFAULT_RELEVANCE,
  }
}

// ── Save entry point ─────────────────────────────────────────────────

export async function saveChatSession(
  input: SaveChatSessionInput,
): Promise<SaveChatSessionResult> {
  if (input.messages.length === 0) {
    throw new Error("No messages to save")
  }
  const trimmedTitle = input.title.trim() || "AI Chat session"

  // Lazy-provision the org's "AI Chat" source on first call.
  const aichatSource = await getOrCreateAiChatSource(input.organizationId)

  // Build the conversation markdown body up-front — used both for the
  // analysis pass and as the persisted body. (Files referenced inline
  // by filename; their bytes become child rows below.)
  const conversation = renderConversation(input.messages, input.files)

  // LLM-derived analysis. Failure here is fatal — without analysis the
  // metadata_json + frontmatter would be misleading. Caller surfaces
  // the error to the user via toast.
  const analysis = await extractAnalysis(conversation)

  // Stable namespaced id used both as `source_item.external_id` and as
  // the YAML frontmatter `source_id`. Each save is a new row (Q1=A).
  const sessionId = randomUUID()
  const parentExternalId = `aichat:${sessionId}`
  const nowIso = new Date().toISOString()

  const frontmatter: SourceFrontmatter = {
    sourceId: parentExternalId,
    parentSourceId: null,
    threadId: null,
    sourceSystem: "AI Chat",
    sourceCreatedAt: nowIso,
    sourceReceivedAt: nowIso,
    processedAt: nowIso,
    language: analysis.language,
    senders: [trimmedTitle],
    recipients: [],
    mentions: analysis.mentions,
    companies: analysis.companies,
    products: analysis.products,
    urls: [],
  }

  const markdown = assembleMarkdown(
    buildFrontmatter(frontmatter),
    analysis.summary,
    conversation,
  )

  // Insert parent. metadata_json carries the analysis fields per the
  // existing denormalisation pattern + provider + title for the row.
  const parentRowId = randomUUID()
  const now = new Date()
  await db.insert(sourceItem).values({
    id: parentRowId,
    sourceId: aichatSource.id,
    organizationId: input.organizationId,
    externalId: parentExternalId,
    externalType: "aichat_session",
    filename: trimmedTitle,
    mimeType: "text/markdown",
    sizeBytes: new TextEncoder().encode(markdown).byteLength,
    sourceCreatedAt: now,
    fetchedAt: now,
    parseStatus: "complete",
    parsedAt: now,
    parserModel: ANALYSIS_MODEL,
    parsedMarkdown: markdown,
    metadataJson: {
      provider: "aichat",
      title: trimmedTitle,
      messageCount: input.messages.length,
      attachmentCount: input.files.length,
      savedByUserId: input.userId,
      savedAt: nowIso,
      ...analysis,
    },
  })

  // Per-file children — reuse the existing dropoff parser dispatch so
  // PDF / image / audio / video / office handling all "just works".
  let childInserted = 0
  let childSkipped = 0
  let childFailed = 0
  const perFileResults: SaveChatSessionResult["perFileResults"] = []

  for (let i = 0; i < input.files.length; i++) {
    const file = input.files[i]
    const childExternalId = `aichat-att:${sessionId}:${i}`
    try {
      const parsed = await parseDropoffFile({
        bytes: file.bytes,
        fileName: file.fileName,
        mediaType: file.mediaType || "application/octet-stream",
        // Reuse the session id as the dropoffId namespace inside the
        // dropoff parser — the resulting markdown frontmatter says
        // "Dropped File", which is fine: the source_item provider on
        // OUR side is aichat, and the parent ref disambiguates.
        dropoffId: `${sessionId}-${i}`,
        description: `Attached to AI chat session "${trimmedTitle}"`,
      })

      // First block is the body; videos emit a second (audio) block.
      const firstBlock = parsed.blocks[0]
      const childRowId = randomUUID()
      await db.insert(sourceItem).values({
        id: childRowId,
        sourceId: aichatSource.id,
        organizationId: input.organizationId,
        externalId: childExternalId,
        externalType: "attachment",
        parentSourceItemId: parentRowId,
        filename: file.fileName,
        mimeType: parsed.mediaType,
        sizeBytes: parsed.byteSize,
        sourceCreatedAt: now,
        fetchedAt: now,
        parseStatus: "complete",
        parsedAt: now,
        parserModel: ANALYSIS_MODEL,
        parsedMarkdown: firstBlock.markdown,
        metadataJson: {
          provider: "aichat",
          parentItemId: parentRowId,
          ...firstBlock.analysis,
        },
      })

      // Extra blocks (video → audio) become grandchildren of this row,
      // matching the dropoff convention in the existing upload route.
      for (let b = 1; b < parsed.blocks.length; b++) {
        const extra = parsed.blocks[b]
        await db.insert(sourceItem).values({
          id: randomUUID(),
          sourceId: aichatSource.id,
          organizationId: input.organizationId,
          externalId: `${childExternalId}:audio`,
          externalType:
            extra.kind === "video_audio" ? "derived_audio" : "attachment",
          parentSourceItemId: childRowId,
          filename: file.fileName,
          mimeType: extra.kind === "video_audio" ? "audio/mp4" : parsed.mediaType,
          sourceCreatedAt: now,
          fetchedAt: now,
          parseStatus: "complete",
          parsedAt: now,
          parserModel: ANALYSIS_MODEL,
          parsedMarkdown: extra.markdown,
          metadataJson: { provider: "aichat", ...extra.analysis },
        })
      }

      childInserted++
      perFileResults.push({ fileName: file.fileName, ok: true })
    } catch (err) {
      const classified = classifyFileError(err)
      if (classified.kind === "skipped") {
        childSkipped++
        // Insert a "skipped" placeholder child so the operator can see
        // why the file didn't land. parsed_markdown is null.
        await db.insert(sourceItem).values({
          id: randomUUID(),
          sourceId: aichatSource.id,
          organizationId: input.organizationId,
          externalId: childExternalId,
          externalType: "attachment",
          parentSourceItemId: parentRowId,
          filename: file.fileName,
          mimeType: file.mediaType || "application/octet-stream",
          sizeBytes: file.bytes.byteLength,
          sourceCreatedAt: now,
          fetchedAt: now,
          parseStatus: "skipped",
          parsedAt: now,
          parseError: classified.reason,
        })
        perFileResults.push({
          fileName: file.fileName,
          ok: false,
          reason: classified.reason,
        })
      } else {
        childFailed++
        await db.insert(sourceItem).values({
          id: randomUUID(),
          sourceId: aichatSource.id,
          organizationId: input.organizationId,
          externalId: childExternalId,
          externalType: "attachment",
          parentSourceItemId: parentRowId,
          filename: file.fileName,
          mimeType: file.mediaType || "application/octet-stream",
          sizeBytes: file.bytes.byteLength,
          sourceCreatedAt: now,
          fetchedAt: now,
          parseStatus: "failed",
          parsedAt: now,
          parseError: classified.reason,
        })
        perFileResults.push({
          fileName: file.fileName,
          ok: false,
          error: classified.reason,
        })
      }
    }
  }

  // Stamp parent's R2 status — uploaded later via the existing manual
  // upload control on /sources. Same posture as dropoff/whatsapp.
  await db
    .update(sourceItem)
    .set({ updatedAt: now })
    .where(eq(sourceItem.id, parentRowId))

  return {
    itemId: parentRowId,
    parentExternalId,
    childInserted,
    childSkipped,
    childFailed,
    perFileResults,
  }
}

// Mirrors the classifier in src/app/api/sources/dropoff/upload/route.ts —
// keeps file errors as soft "skipped" outcomes rather than failing the
// whole save operation.
function classifyFileError(err: unknown): {
  kind: "skipped" | "failed"
  reason: string
} {
  if (
    err instanceof PdfTooLargeError ||
    err instanceof ImageTooLargeError ||
    err instanceof AudioTooLargeError ||
    err instanceof VideoTooLargeError ||
    err instanceof OfficeTooLargeError
  ) {
    return { kind: "skipped", reason: `too large: ${err.message}` }
  }
  if (
    err instanceof UnsupportedImageTypeError ||
    err instanceof UnsupportedAudioTypeError ||
    err instanceof UnsupportedVideoTypeError ||
    err instanceof UnsupportedOfficeTypeError ||
    err instanceof UnsupportedDropoffTypeError
  ) {
    return { kind: "skipped", reason: "unsupported file type" }
  }
  return {
    kind: "failed",
    reason: err instanceof Error ? err.message : String(err),
  }
}
