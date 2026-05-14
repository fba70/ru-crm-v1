import "server-only"
import { generateText, Output } from "ai"
import { z } from "zod"
import nylas from "@/lib/nylas"
import { PARSER_CONFIG } from "@/lib/parser-config"
import type { NylasCredentials } from "@/server/providers/handlers"
import {
  assembleMarkdown,
  buildFrontmatter,
  emailsToDomainUrls,
  extractUrls,
  uniqueStrings,
  type MetadataAnalysis,
  type SourceFrontmatter,
} from "@/server/parsers/_shared"

// Set of "junk" categories the parser drops before the email reaches the
// markdown corpus. Conservative by design — see the system prompt for the
// non-junk carve-outs (receipts, lead-form submissions, etc.).
const JUNK_CATEGORIES = [
  "account_verification",
  "security_alert",
  "system_notification",
  "system_invitation",
  "marketing",
  "service_status",
  "calendar_only",
  "other",
] as const

export type JunkCategory = (typeof JUNK_CATEGORIES)[number]

const analysisSchema = z.object({
  relevance: z
    .object({
      isJunk: z
        .boolean()
        .describe(
          "True if the email is automated/transactional and has no business value to a CRM (verification mail, security alerts, system notifications, SaaS team invitations, newsletters, service-status mail, bare calendar invites). When uncertain, set to false.",
        ),
      category: z
        .enum(JUNK_CATEGORIES)
        .nullable()
        .describe(
          "Category when isJunk is true; null otherwise. Pick the closest match.",
        ),
      reason: z
        .string()
        .describe(
          "One short sentence in English explaining the classification. Empty string if not junk.",
        ),
    })
    .describe("Junk classification (see system prompt for rules)."),
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
      "Names of every person mentioned by name anywhere in the body text — including the sender's own name (e.g. in a sign-off) and any recipients addressed by name (e.g. 'Sehr geehrter Herr Ditachmair'). Use the form they are addressed/signed as in the body (first name, full name, or 'Herr/Frau LastName' as written). Do not invent names that are not present in the text.",
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
      "The full message body converted to clean, readable Markdown. Preserve paragraphs, lists, code blocks, tables, and quotes. Strip tracking pixels, signatures rendered as image grids, and boilerplate unsubscribe footers. Do NOT include the frontmatter or a '## Content' heading — only the body content itself. When relevance.isJunk is true, return '(filtered)' here — the body is discarded so do not waste tokens converting it.",
    ),
})

// Thrown by parseEmailMessage when the LLM classifies the email as junk.
// Caught by parseSourceItem (in src/server/parse-source-item.ts) and
// converted to parseStatus = 'skipped' so the row stays in the DB as an
// audit trail but never re-parses on subsequent cron runs (the upsert
// in syncs preserves parseStatus).
export class EmailFilteredError extends Error {
  readonly category: JunkCategory
  readonly classifierReason: string
  constructor(category: JunkCategory, classifierReason: string) {
    super(`Email filtered as ${category}: ${classifierReason}`)
    this.name = "EmailFilteredError"
    this.category = category
    this.classifierReason = classifierReason
  }
}

const SYSTEM_PROMPT = `You are a precise email parsing assistant. You do two things in one pass:

1. CLASSIFY whether the email is "junk" (automated/transactional with no business value to a CRM).
2. EXTRACT structured metadata and convert the body to clean markdown.

═══════════════════════════════════════════════════════════
JUNK CLASSIFICATION (relevance.isJunk)
═══════════════════════════════════════════════════════════

Set relevance.isJunk = true when the email matches one of these categories. Pick the closest category and write a one-sentence reason in English. Examples cover English + German; classify other languages by intent.

JUNK CATEGORIES:

• account_verification — "Verify your email", "Confirm your address", magic links, email-change confirmations.
  DE: "Bestätigen Sie Ihre E-Mail-Adresse", "E-Mail-Adresse verifizieren"

• security_alert — Sign-in notifications, 2FA codes, password resets, suspicious-activity warnings.
  DE: "Sicherheitswarnung", "Passwort zurücksetzen", "Neue Anmeldung", "Verdächtige Aktivität"

• system_notification — Service-provider notifications about your own account: storage limits, policy updates, billing reminders from infrastructure (Google, Microsoft, AWS, etc.).
  DE: "Speicherplatz fast voll", "Aktualisierte Nutzungsbedingungen"

• system_invitation — "X invited you to <SaaS tool>" workspace/team join requests (Slack, Notion, Linear, Trello, etc.).
  DE: "X hat Sie eingeladen", "Einladung zu …"

• marketing — Newsletters, promotional bulk mail, product announcements, content dominated by an unsubscribe footer.
  DE: "Newsletter", "Abmelden"

• service_status — Uptime alerts, scheduled maintenance, "We updated our terms", mass policy mail.

• calendar_only — Bare calendar invites with no human message body (only an .ics description).

DO NOT mark as junk:
- Receipts, invoices, order confirmations (business-relevant spend tracking)
- Form submissions / lead notifications ("New contact request from …")
- Calendar invites that include a real human message body in addition to the .ics
- Personal emails from individuals, even if from a security-related domain
- Any email where you are uncertain

⚠ BE CONSERVATIVE. Marking a real business email as junk loses important data. When in doubt, set isJunk = false.

When relevance.isJunk = true, set contentMarkdown to "(filtered)" — the body will be discarded.

═══════════════════════════════════════════════════════════
EXTRACTION (when isJunk = false)
═══════════════════════════════════════════════════════════

Extract structured metadata and convert the body to clean readable markdown. Never fabricate facts — only return what is present in the message.`

export type ParsedSource = {
  markdown: string
  metadata: {
    sourceId: string
    threadId: string | null
    sourceSystem: string
    subject: string
  }
}

export type NylasAttachmentRef = {
  attachmentId: string
  filename: string
  contentType: string
  size: number
  isInline: boolean
}

// Images embedded directly in the body HTML as `data:image/...;base64,...`
// URIs. These are NOT Nylas attachments — we carry the decoded bytes inline
// so the caller doesn't need to hit Nylas to retrieve them.
export type InlineBodyImage = {
  filename: string
  mediaType: string
  bytes: Uint8Array
}

export type ParsedEmail = ParsedSource & {
  attachments: NylasAttachmentRef[]
  bodyInlineImages: InlineBodyImage[]
  sourceCreatedAt: string | null
  messageId: string
  threadId: string | null
  analysis: MetadataAnalysis
}

/**
 * Parse a Nylas email message into a structured markdown document
 * conforming to refs/parsing-sources-template.md.
 *
 * Deterministic fields (thread_id, dates, senders, recipients, urls) are
 * extracted directly from the Nylas payload. Content-derived fields
 * (summary, mentions, companies, products, language, clean markdown body)
 * are produced by the LLM via generateText + Output.object().
 *
 * Also surfaces the raw attachment list so the caller can chain format-
 * specific parsers (PDF, audio, …) against each attachment.
 */
export async function parseEmailMessage(
  emailId: string,
  creds: NylasCredentials,
): Promise<ParsedEmail> {
  const { data: msg } = await nylas.messages.find({
    identifier: creds.grantId,
    messageId: emailId,
  })

  const bodyHtml = msg.body ?? ""
  const bodyText = htmlToPlainText(bodyHtml)
  const subject = msg.subject ?? "(no subject)"

  const senders = uniqueStrings(
    (msg.from ?? []).map((p) => p.email || ""),
  )
  const recipients = uniqueStrings([
    ...(msg.to ?? []).map((p) => p.email || ""),
    ...(msg.cc ?? []).map((p) => p.email || ""),
    ...(msg.bcc ?? []).map((p) => p.email || ""),
  ])

  const bodyUrls = extractUrls(`${bodyHtml}\n${bodyText}`)
  const participantDomainUrls = emailsToDomainUrls([...senders, ...recipients])
  const urls = uniqueStrings([...bodyUrls, ...participantDomainUrls])

  const sourceCreatedAt = msg.date
    ? new Date(msg.date * 1000).toISOString()
    : null
  const nowIso = new Date().toISOString()

  const { output: analysis } = await generateText({
    model: PARSER_CONFIG.text.model,
    output: Output.object({ schema: analysisSchema }),
    system: SYSTEM_PROMPT,
    prompt: buildLlmPrompt({ subject, senders, recipients, bodyText }),
  })

  // Junk filter: short-circuit before assembling markdown. The thrown
  // error is converted to parseStatus = 'skipped' by parseSourceItem so
  // the row stays as an audit record but never re-parses.
  if (analysis.relevance.isJunk) {
    throw new EmailFilteredError(
      analysis.relevance.category ?? "other",
      analysis.relevance.reason || "(no reason provided)",
    )
  }

  const frontmatterFields: SourceFrontmatter = {
    sourceId: `nylas:${msg.id}`,
    parentSourceId: null,
    threadId: msg.threadId ?? null,
    sourceSystem: "Email",
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
    buildFrontmatter(frontmatterFields),
    analysis.summary,
    analysis.contentMarkdown,
  )

  // Keep inline attachments — they're often CID-referenced images embedded
  // in the HTML body (<img src="cid:…">) and the user wants those parsed
  // the same as regular attachments.
  const attachments: NylasAttachmentRef[] =
    msg.attachments
      ?.filter((a) => !!a.id)
      .map((a) => ({
        attachmentId: a.id!,
        filename: a.filename ?? "unknown",
        contentType: a.contentType ?? "application/octet-stream",
        size: a.size ?? 0,
        isInline: Boolean(a.isInline),
      })) ?? []

  const bodyInlineImages = extractBodyDataUriImages(bodyHtml)

  return {
    markdown,
    metadata: {
      sourceId: `nylas:${msg.id}`,
      threadId: msg.threadId ?? null,
      sourceSystem: "Email",
      subject,
    },
    attachments,
    bodyInlineImages,
    sourceCreatedAt,
    messageId: msg.id,
    threadId: msg.threadId ?? null,
    analysis: {
      language: analysis.language || "en",
      summary: analysis.summary,
      mentions: uniqueStrings(analysis.mentions),
      companies: uniqueStrings(analysis.companies),
      products: uniqueStrings(analysis.products),
      relevance: {
        isJunk: analysis.relevance.isJunk,
        category: analysis.relevance.category,
        reason: analysis.relevance.reason,
      },
    },
  }
}

/**
 * Scan the body HTML for `data:image/{jpeg,png};base64,…` URIs and decode
 * each into a synthetic inline-image entry. These are embedded directly in
 * the HTML and never surface as Nylas attachments, so they have to be
 * extracted here.
 */
function extractBodyDataUriImages(html: string): InlineBodyImage[] {
  if (!html) return []
  const out: InlineBodyImage[] = []
  const seen = new Set<string>()
  const re = /data:(image\/(?:jpeg|jpg|png));base64,([A-Za-z0-9+/=]+)/gi
  let match: RegExpExecArray | null
  let index = 0
  while ((match = re.exec(html)) !== null) {
    const rawMediaType = match[1].toLowerCase()
    const mediaType = rawMediaType === "image/jpg" ? "image/jpeg" : rawMediaType
    const b64 = match[2]
    // Dedupe identical encodings — emails often reference the same inline
    // image twice (e.g. signatures rendered in both light+dark variants).
    if (seen.has(b64)) continue
    seen.add(b64)
    try {
      const bytes = Uint8Array.from(Buffer.from(b64, "base64"))
      if (bytes.byteLength === 0) continue
      const ext = mediaType === "image/png" ? "png" : "jpg"
      out.push({
        filename: `inline-${index + 1}.${ext}`,
        mediaType,
        bytes,
      })
      index++
    } catch {
      // Malformed base64 — skip silently.
    }
  }
  return out
}

function buildLlmPrompt(args: {
  subject: string
  senders: string[]
  recipients: string[]
  bodyText: string
}): string {
  const { subject, senders, recipients, bodyText } = args
  const truncated =
    bodyText.length > 60_000
      ? `${bodyText.slice(0, 60_000)}\n\n[...truncated, ${bodyText.length - 60_000} additional characters omitted]`
      : bodyText

  return [
    `Subject: ${subject}`,
    `From: ${senders.join(", ") || "(unknown)"}`,
    `To: ${recipients.join(", ") || "(unknown)"}`,
    "",
    "--- BEGIN MESSAGE BODY ---",
    truncated || "(empty body)",
    "--- END MESSAGE BODY ---",
  ].join("\n")
}

function htmlToPlainText(html: string): string {
  if (!html) return ""
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
