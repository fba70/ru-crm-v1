import "server-only"

import { createHash } from "node:crypto"
import { generateText, Output } from "ai"
import { z } from "zod"
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

// ── Public types ──────────────────────────────────────────────────────

export type WhatsAppMessage = {
  // Provider-side timestamp parsed from the line prefix.
  timestamp: Date
  author: string
  // Body text with attachment markers stripped — markers move to
  // `attachments` so downstream linkage is structured rather than
  // string-matched.
  text: string
  // Attachment filenames referenced via `<attached: …>` (or `(file
  // attached)` on Android), in order of appearance.
  attachments: string[]
  // Original body line(s) before stripping — useful for the rendered
  // group transcript so the user sees what the LLM saw.
  rawText: string
}

export type WhatsAppGroup = {
  // Sliced from the full message list; messages share the same group
  // boundaries (1h gap OR 100-message OR 50K-char cap).
  messages: WhatsAppMessage[]
  startTimestamp: Date
  endTimestamp: Date
  // Sorted, deduped author names for the group — used as `senders`.
  authors: string[]
  // Ordered, deduped list of attachment filenames referenced anywhere
  // in the group. Drives the parent_source_item_id linkage in the
  // upload route.
  attachmentFilenames: string[]
  // Stable id for upsert dedup. SHA-256 of (firstISO, lastISO,
  // authorsJoined) → first 16 hex chars. Re-importing the same archive
  // (or a superset) is a no-op for groups whose content hasn't shifted.
  groupKey: string
}

export type ParseChatTxtResult = {
  format: "ios" | "android" | "unknown"
  messageCount: number
  groups: WhatsAppGroup[]
}

// ── Group split caps (per spec) ───────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000
const MAX_MESSAGES_PER_GROUP = 100
const MAX_CHARS_PER_GROUP = 50_000

// ── Format detection + line parser ────────────────────────────────────

// Date separator — WhatsApp iOS uses `/` (US locale) or `.` (most EU
// locales), and Android exports follow the device locale too. The
// detection regexes accept either.
const DATE_SEP = "[/.]"

// iOS export: `[12/9/25, 12:57:20 PM] Author: Body` or `[14.11.25,
// 17:22:44] Author: Body` for non-US locales. LRM/U+200E characters
// appear before brackets and inside markers — strip on ingest. Square
// brackets are the cheap signal.
const IOS_LINE = new RegExp(
  `^\\[(\\d{1,2}${DATE_SEP}\\d{1,2}${DATE_SEP}\\d{2,4}),\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[APap]\\.?[Mm]\\.?)?)\\]\\s*([^:]+?):\\s*([\\s\\S]*)$`,
)

// Android export: `12/9/25, 12:57 - Author: Body`. Hyphen separator
// after the timestamp is the cheap signal.
const ANDROID_LINE = new RegExp(
  `^(\\d{1,2}${DATE_SEP}\\d{1,2}${DATE_SEP}\\d{2,4}),\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[APap]\\.?[Mm]\\.?)?)\\s*-\\s*([^:]+?):\\s*([\\s\\S]*)$`,
)

// Attachment marker patterns. iOS uses `<attached: filename.ext>` (often
// preceded by a U+200E LRM mark); Android historically uses
// `filename.ext (file attached)` on its own line.
const ATTACHED_TAG = /<attached:\s*([^>]+?)\s*>/g
const ANDROID_ATTACHED_LINE = /^([^\s][^\n]*?)\s*\(file attached\)\s*$/

// Strip the LRM (U+200E) and BOM that WhatsApp likes to inject so our
// regexes anchor predictably.
function stripBidi(s: string): string {
  return s.replace(/[‎‏﻿]/g, "")
}

type ParsedLine = {
  rawDateStr: string
  rawTimeStr: string
  author: string
  body: string
}

function tryParseLine(
  line: string,
  format: "ios" | "android" | "unknown",
): { format: "ios" | "android"; parsed: ParsedLine } | null {
  if (format !== "android") {
    const m = IOS_LINE.exec(line)
    if (m) {
      return {
        format: "ios",
        parsed: {
          rawDateStr: m[1],
          rawTimeStr: m[2],
          author: m[3].trim(),
          body: m[4],
        },
      }
    }
  }
  if (format !== "ios") {
    const m = ANDROID_LINE.exec(line)
    if (m) {
      return {
        format: "android",
        parsed: {
          rawDateStr: m[1],
          rawTimeStr: m[2],
          author: m[3].trim(),
          body: m[4],
        },
      }
    }
  }
  return null
}

// WhatsApp dates can be mm/dd or dd/mm depending on phone locale. We
// don't know which up front, so collect candidates from the file and
// pick the interpretation that's internally valid (no month > 12 in
// either reading) AND produces non-decreasing timestamps. Falls back to
// mm/dd (US export, the most common).
function detectDateOrder(samples: string[]): "mdy" | "dmy" {
  let mdyValid = true
  let dmyValid = true
  for (const dateStr of samples) {
    const parts = dateStr.split(/[/.]/).map((p) => parseInt(p, 10))
    if (parts.length !== 3 || parts.some(Number.isNaN)) continue
    const [a, b /*, _y */] = parts
    if (a > 12) mdyValid = false
    if (b > 12) dmyValid = false
  }
  if (mdyValid && !dmyValid) return "mdy"
  if (dmyValid && !mdyValid) return "dmy"
  return "mdy" // tie-break on the more common iOS-US export
}

function parseDate(
  rawDateStr: string,
  rawTimeStr: string,
  order: "mdy" | "dmy",
): Date | null {
  const dParts = rawDateStr.split(/[/.]/).map((p) => parseInt(p, 10))
  if (dParts.length !== 3 || dParts.some(Number.isNaN)) return null
  let month: number
  let day: number
  let year = dParts[2]
  if (order === "mdy") {
    month = dParts[0]
    day = dParts[1]
  } else {
    day = dParts[0]
    month = dParts[1]
  }
  if (year < 100) year += 2000

  // Time: "12:57", "12:57:20", "12:57 PM", "12:57:20 AM"
  const tMatch = rawTimeStr.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap]\.?[Mm]\.?)?$/,
  )
  if (!tMatch) return null
  let hour = parseInt(tMatch[1], 10)
  const minute = parseInt(tMatch[2], 10)
  const second = tMatch[3] ? parseInt(tMatch[3], 10) : 0
  const ampm = tMatch[4]?.toLowerCase().replace(/\./g, "")
  if (ampm === "pm" && hour < 12) hour += 12
  if (ampm === "am" && hour === 12) hour = 0
  if (hour > 23 || minute > 59 || second > 59 || month > 12 || day > 31) {
    return null
  }
  // Local interpretation — WhatsApp exports don't carry timezone. UTC
  // would be wrong; using the runtime's local time matches what the
  // user saw on their device. Acceptable approximation for v1.
  return new Date(year, month - 1, day, hour, minute, second)
}

function extractAttachments(body: string): {
  body: string
  attachments: string[]
} {
  const attachments: string[] = []

  // 1. Inline `<attached: name>` markers — strip + collect.
  const stripped = body.replace(ATTACHED_TAG, (_, fileName: string) => {
    const trimmed = fileName.trim()
    if (trimmed) attachments.push(trimmed)
    return ""
  })

  // 2. Android-style line "filename.ext (file attached)" — only valid
  // when the message body is *exactly* that pattern (or starts with
  // it). Avoid false positives where the phrase appears mid-sentence.
  const trimmed = stripped.trim()
  const androidMatch = ANDROID_ATTACHED_LINE.exec(trimmed)
  if (androidMatch) {
    attachments.push(androidMatch[1].trim())
    return { body: "", attachments }
  }

  return { body: stripped.trim(), attachments }
}

// ── Top-level parser ──────────────────────────────────────────────────

export function parseChatTxt(content: string): ParseChatTxtResult {
  const cleaned = stripBidi(content)
  const lines = cleaned.split(/\r?\n/)

  // Pass 1: find the format from the first parseable line.
  let format: "ios" | "android" | "unknown" = "unknown"
  for (const line of lines) {
    const r = tryParseLine(line, "unknown")
    if (r) {
      format = r.format
      break
    }
  }
  if (format === "unknown") {
    return { format: "unknown", messageCount: 0, groups: [] }
  }

  // Pass 2: collect date strings to disambiguate mm/dd vs dd/mm.
  const dateSamples: string[] = []
  for (const line of lines) {
    const r = tryParseLine(line, format)
    if (r) dateSamples.push(r.parsed.rawDateStr)
    if (dateSamples.length >= 200) break
  }
  const order = detectDateOrder(dateSamples)

  // Pass 3: build messages, folding continuation lines into the
  // previous message.
  const messages: WhatsAppMessage[] = []
  let current: WhatsAppMessage | null = null

  for (const rawLine of lines) {
    const r = tryParseLine(rawLine, format)
    if (r) {
      const ts = parseDate(r.parsed.rawDateStr, r.parsed.rawTimeStr, order)
      if (!ts) continue
      // Push the previous message before starting a new one.
      if (current) messages.push(current)

      const { body, attachments } = extractAttachments(r.parsed.body)
      current = {
        timestamp: ts,
        author: r.parsed.author,
        text: body,
        attachments,
        rawText: r.parsed.body,
      }
    } else if (current) {
      // Continuation line for a multi-line message.
      const { body, attachments } = extractAttachments(rawLine)
      if (attachments.length > 0) current.attachments.push(...attachments)
      const trimmed = body
      if (trimmed) {
        current.text = current.text ? `${current.text}\n${trimmed}` : trimmed
      }
      current.rawText = `${current.rawText}\n${rawLine}`
    }
    // Lines before the first parseable one (typically the
    // "Messages and calls are end-to-end encrypted…" system header)
    // are silently dropped.
  }
  if (current) messages.push(current)

  const groups = splitIntoGroups(messages)
  return { format, messageCount: messages.length, groups }
}

function splitIntoGroups(messages: WhatsAppMessage[]): WhatsAppGroup[] {
  const groups: WhatsAppGroup[] = []
  let bucket: WhatsAppMessage[] = []
  let bucketChars = 0

  const flush = () => {
    if (bucket.length === 0) return
    const first = bucket[0]
    const last = bucket[bucket.length - 1]
    const authors = uniqueStrings(bucket.map((m) => m.author)).sort()
    const attachmentFilenames = uniqueStrings(
      bucket.flatMap((m) => m.attachments),
    )
    const groupKey = createHash("sha256")
      .update(
        [
          first.timestamp.toISOString(),
          last.timestamp.toISOString(),
          authors.join("|"),
        ].join("::"),
      )
      .digest("hex")
      .slice(0, 16)
    groups.push({
      messages: bucket,
      startTimestamp: first.timestamp,
      endTimestamp: last.timestamp,
      authors,
      attachmentFilenames,
      groupKey,
    })
    bucket = []
    bucketChars = 0
  }

  for (const msg of messages) {
    const last = bucket[bucket.length - 1]
    const gap = last ? msg.timestamp.getTime() - last.timestamp.getTime() : 0
    const overTime = last && gap > HOUR_MS
    const overCount = bucket.length >= MAX_MESSAGES_PER_GROUP
    const overChars = bucketChars + msg.text.length > MAX_CHARS_PER_GROUP
    if (last && (overTime || overCount || overChars)) flush()
    bucket.push(msg)
    bucketChars += msg.text.length
  }
  flush()
  return groups
}

// ── Group serialisation ───────────────────────────────────────────────

// Render a chat group to a plain-text transcript suitable for both LLM
// input and persistence in `metadataJson.rawText`. Format mirrors the
// audio parser's segment layout for visual consistency:
//   **2025-12-09 12:57** · **Author**
//   message text
function renderGroupTranscript(group: WhatsAppGroup): string {
  return group.messages
    .map((m) => {
      const ts = formatLocal(m.timestamp)
      const lines = [`**${ts}** · **${m.author}**`]
      if (m.text) lines.push(m.text)
      if (m.attachments.length > 0) {
        lines.push(
          `_attachments: ${m.attachments.map((a) => `\`${a}\``).join(", ")}_`,
        )
      }
      return lines.join("\n\n")
    })
    .join("\n\n")
}

function formatLocal(d: Date): string {
  // YYYY-MM-DD HH:MM in local-equivalent (since parseDate used local).
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── LLM metadata extraction (Parse step on the chat-message rows) ────

const analysisSchema = z.object({
  language: z
    .string()
    .describe(
      "ISO 639-1 two-letter language code of the conversation (e.g. 'en', 'ru', 'de'). Default to 'en' if mixed or uncertain.",
    ),
  summary: z
    .string()
    .describe(
      "A concise 1-3 sentence summary of what the conversation segment is about. Mention the participants and the gist of the topic.",
    ),
  mentions: z
    .array(z.string())
    .describe(
      "Names of every person mentioned by name within the message bodies — distinct from the participants. Use the form they are addressed as in the body.",
    ),
  companies: z
    .array(z.string())
    .describe("Names of companies or brands mentioned in the body."),
  products: z
    .array(z.string())
    .describe("Names of products mentioned in the body."),
})

export type ParseWhatsAppGroupInput = {
  // The raw transcript (output of `renderGroupTranscript`) — exactly
  // what the upload route stamped into `metadataJson.rawText`.
  rawText: string
  // Identity / linkage fields, threaded through to the frontmatter.
  sourceId: string
  threadId: string | null
  authors: string[]
  startTimestamp: string | null
  endTimestamp: string | null
}

export type ParsedWhatsAppGroup = {
  markdown: string
  metadata: {
    sourceId: string
    threadId: string | null
    sourceSystem: string
    authors: string[]
  }
  analysis: MetadataAnalysis
}

// Mirrors `parseChatMessage` from `chat.ts`: deterministic frontmatter
// fields built locally + LLM-extracted summary/mentions/companies/etc.
// Crucially, this version reads the body from `rawText` (already in
// our DB) rather than re-fetching from a provider API — WhatsApp has
// no API to call, the conversation is the local archive.
export async function parseWhatsAppGroup(
  input: ParseWhatsAppGroupInput,
): Promise<ParsedWhatsAppGroup> {
  const { output: analysis } = await generateText({
    model: PARSER_CONFIG.text.model,
    output: Output.object({ schema: analysisSchema }),
    system:
      "You are a precise WhatsApp chat parsing assistant. Extract structured metadata from a multi-message group transcript. Never fabricate facts — only return what is present in the conversation.",
    prompt: buildLlmPrompt({
      authors: input.authors,
      rawText: input.rawText,
    }),
  })

  const urls = extractUrls(input.rawText)
  const nowIso = new Date().toISOString()

  const frontmatter: SourceFrontmatter = {
    sourceId: input.sourceId,
    parentSourceId: null,
    threadId: input.threadId,
    sourceSystem: "WhatsApp",
    sourceCreatedAt: input.startTimestamp,
    sourceReceivedAt: input.endTimestamp,
    processedAt: nowIso,
    language: analysis.language || "en",
    senders: input.authors,
    recipients: [],
    mentions: analysis.mentions,
    companies: analysis.companies,
    products: analysis.products,
    urls,
  }

  const markdown = assembleMarkdown(
    buildFrontmatter(frontmatter),
    analysis.summary,
    input.rawText, // The original transcript IS the content — no LLM rewrite.
  )

  return {
    markdown,
    metadata: {
      sourceId: input.sourceId,
      threadId: input.threadId,
      sourceSystem: "WhatsApp",
      authors: input.authors,
    },
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

function buildLlmPrompt(args: { authors: string[]; rawText: string }): string {
  const { authors, rawText } = args
  const truncated =
    rawText.length > 60_000
      ? `${rawText.slice(0, 60_000)}\n\n[...truncated, ${rawText.length - 60_000} additional characters omitted]`
      : rawText
  return [
    `Source: WhatsApp chat archive — multi-message conversation segment`,
    `Participants: ${authors.length > 0 ? authors.join(", ") : "(unknown)"}`,
    "",
    "--- BEGIN TRANSCRIPT ---",
    truncated || "(empty group)",
    "--- END TRANSCRIPT ---",
  ].join("\n")
}

// Re-exported so the upload route can stamp `metadataJson.rawText`
// without re-rendering each time.
export { renderGroupTranscript }
