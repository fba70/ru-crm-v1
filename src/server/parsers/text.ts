import "server-only"
import { generateText, Output } from "ai"
import { z } from "zod"
import nylas from "@/lib/nylas"
import { PARSER_CONFIG } from "@/lib/parser-config"
import type { NylasCredentials } from "@/server/providers/handlers"
import {
  buildCalendarContext,
  buildMeetingSection,
  eventEmails,
  eventParticipantPairs,
  isIcsAttachment,
  parseIcsToEvent,
  type CalendarEvent,
} from "@/server/parsers/ics"
import {
  assembleMarkdown,
  buildFrontmatter,
  emailsToDomainUrls,
  extractUrls,
  filterMentionedPeople,
  filterOrganizations,
  filterParticipantDetails,
  MENTIONED_PEOPLE_PROMPT,
  mentionedPersonSchema,
  ORGANIZATIONS_PROMPT,
  organizationDetailSchema,
  PARTICIPANT_DETAILS_PROMPT,
  participantDetailSchema,
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
  organizations: z
    .array(organizationDetailSchema)
    .describe(
      "Structured, deduped companies: one entry per distinct real-world company with its alternate spellings + website. See the system prompt for emission rules.",
    ),
  products: z
    .array(z.string())
    .describe("Names of products mentioned in the body."),
  mentionedPeople: z
    .array(mentionedPersonSchema)
    .describe(
      "People mentioned in the email body beyond the sender/recipients (third parties referenced by name). See the system prompt for emission rules.",
    ),
  participantDetails: z
    .array(participantDetailSchema)
    .describe(
      "Details (native-language name + phone + position / job title) for the envelope participants (From/To/Cc/Bcc), recovered from the body (signature / contact block). See the system prompt for emission rules.",
    ),
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

Extract structured metadata and convert the body to clean readable markdown. Never fabricate facts — only return what is present in the message.

${MENTIONED_PEOPLE_PROMPT}

For email specifically: the "author/sender" is the From: address; recipients (To/Cc/Bcc) are also captured elsewhere — don't include them in mentionedPeople either. Only mention third parties referenced inside the body. When inferring organization from the sender's affiliation, derive the sender's company from their email domain (e.g. sender alice@acme.com → "Acme" as the inferred org).

${ORGANIZATIONS_PROMPT}

${PARTICIPANT_DETAILS_PROMPT}`

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

  // Calendar (.ics) invite: decode the first one carried by this email and
  // fold it into THIS item (metadata + markdown). Best-effort — a malformed
  // invite (or a failed download) must never fail the email parse.
  const calendarEvent = await extractCalendarEvent(msg, creds)

  const sourceCreatedAt = msg.date
    ? new Date(msg.date * 1000).toISOString()
    : null

  // Run the shared email LLM pipeline (prompt → Gemini → junk filter →
  // frontmatter + markdown + analysis). Identical for Nylas and IMAP, so it
  // lives in one place; the provider-specific work is only the body fetch +
  // attachment byte retrieval.
  const { markdown, analysis } = await analyzeAndAssembleEmail({
    sourceId: `nylas:${msg.id}`,
    sourceSystem: "Email",
    subject,
    senders,
    recipients,
    bodyHtml,
    bodyText,
    sourceCreatedAt,
    threadId: msg.threadId ?? null,
    calendarEvent,
  })

  // Keep inline attachments — they're often CID-referenced images embedded
  // in the HTML body (<img src="cid:…">) and the user wants those parsed
  // the same as regular attachments. Exclude the `.ics` itself: it's already
  // folded into this item's metadata + markdown, and the format-parser
  // dispatch has no .ics handler (it would become a noise "unsupported type"
  // child).
  const attachments: NylasAttachmentRef[] =
    msg.attachments
      ?.filter((a) => !!a.id)
      .filter((a) => !isIcsAttachment(a.contentType, a.filename))
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
    analysis,
  }
}

// Deterministic email fields handed to the shared LLM pipeline. The provider
// parsers (Nylas / IMAP) extract these their own way (Nylas SDK vs
// mailparser) then delegate the identical analysis + markdown assembly here.
export type EmailLlmInput = {
  // Namespaced frontmatter source id, e.g. "nylas:<id>" / "imap:<uidv>:<uid>".
  sourceId: string
  // `source_system` frontmatter label (always "Email" today).
  sourceSystem: string
  subject: string
  senders: string[]
  recipients: string[]
  // HTML body (for URL extraction); may be "" when only plain text is present.
  bodyHtml: string
  // Plain-text body fed to the LLM.
  bodyText: string
  sourceCreatedAt: string | null
  threadId: string | null
  // Decoded calendar invite folded into this email, or null.
  calendarEvent: CalendarEvent | null
}

/**
 * The shared email analysis + assembly pipeline. One Gemini pass produces the
 * `MetadataAnalysis`; a junk classification short-circuits via
 * `EmailFilteredError` (unless a real calendar invite overrides it); the body
 * is assembled into the frontmatter + `## Meeting` markdown. Reused verbatim by
 * both `parseEmailMessage` (Nylas) and `parseImapMessage` (IMAP) so the two
 * produce identical markdown + analysis shapes.
 */
export async function analyzeAndAssembleEmail(
  input: EmailLlmInput,
): Promise<{ markdown: string; analysis: MetadataAnalysis }> {
  const {
    sourceId,
    sourceSystem,
    subject,
    senders,
    recipients,
    bodyHtml,
    bodyText,
    sourceCreatedAt,
    threadId,
    calendarEvent,
  } = input

  const bodyUrls = extractUrls(`${bodyHtml}\n${bodyText}`)
  const participantDomainUrls = emailsToDomainUrls([
    ...senders,
    ...recipients,
    ...(calendarEvent ? eventEmails(calendarEvent) : []),
  ])
  const urls = uniqueStrings([...bodyUrls, ...participantDomainUrls])

  const nowIso = new Date().toISOString()

  const { output: analysis } = await generateText({
    model: PARSER_CONFIG.text.model,
    output: Output.object({ schema: analysisSchema }),
    system: SYSTEM_PROMPT,
    prompt: buildLlmPrompt({
      subject,
      senders,
      recipients,
      bodyText,
      calendarContext: calendarEvent
        ? buildCalendarContext(calendarEvent)
        : null,
    }),
  })

  // Junk filter: short-circuit before assembling markdown. The thrown
  // error is converted to parseStatus = 'skipped' by parseSourceItem so
  // the row stays as an audit record but never re-parses. A real calendar
  // invite always survives — even a bare (body-less) invite carries a full
  // attendee roster + meeting we want, so it overrides the classifier.
  if (analysis.relevance.isJunk && !calendarEvent) {
    throw new EmailFilteredError(
      analysis.relevance.category ?? "other",
      analysis.relevance.reason || "(no reason provided)",
    )
  }
  if (calendarEvent && analysis.relevance.isJunk) {
    analysis.relevance = { isJunk: false, category: null, reason: "" }
  }

  const frontmatterFields: SourceFrontmatter = {
    sourceId,
    parentSourceId: null,
    threadId,
    sourceSystem,
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

  // Fold the meeting into the body markdown. For a bare invite (the LLM
  // returned "(filtered)" / empty body) the `## Meeting` section becomes the
  // whole content instead of being dropped.
  const contentMarkdown = calendarEvent
    ? mergeMeetingIntoContent(analysis.contentMarkdown, calendarEvent)
    : analysis.contentMarkdown

  const markdown = assembleMarkdown(
    buildFrontmatter(frontmatterFields),
    analysis.summary,
    contentMarkdown,
  )

  return {
    markdown,
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
      mentionedPeople: filterMentionedPeople(analysis.mentionedPeople ?? []),
      organizations: filterOrganizations(analysis.organizations ?? []),
      // Native name + phone are only kept for actual envelope addresses
      // (sender + recipients), lowercased to match how discovery keys
      // participants.
      participantDetails: filterParticipantDetails(
        analysis.participantDetails ?? [],
        new Set([...senders, ...recipients].map((e) => e.trim().toLowerCase())),
      ),
      // Authoritative roster from the .ics invite (organizer + attendees).
      // Only present on calendar emails; discovery reads it as a canonical
      // participant source. Omitted entirely for non-calendar rows.
      ...(calendarEvent
        ? { participants: eventParticipantPairs(calendarEvent) }
        : {}),
    },
  }
}

/**
 * Detect + decode the first iCalendar (.ics) attachment on a Nylas message.
 * Downloads the bytes (one extra Nylas call per invite) and parses the first
 * VEVENT. Returns null when there is no .ics, the download fails, or the blob
 * is unparseable — strictly best-effort so it can never fail the email parse.
 */
async function extractCalendarEvent(
  msg: { id: string; attachments?: NylasAttachmentRef[] | unknown[] },
  creds: NylasCredentials,
): Promise<CalendarEvent | null> {
  const list = (msg.attachments ?? []) as Array<{
    id?: string | null
    filename?: string | null
    contentType?: string | null
  }>
  const ics = list.find(
    (a) => a?.id && isIcsAttachment(a.contentType, a.filename),
  )
  if (!ics?.id) return null
  try {
    const buffer = await nylas.attachments.downloadBytes({
      identifier: creds.grantId,
      attachmentId: ics.id,
      queryParams: { messageId: msg.id },
    })
    return parseIcsToEvent(new Uint8Array(buffer))
  } catch {
    return null
  }
}

/**
 * Scan the body HTML for `data:image/{jpeg,png};base64,…` URIs and decode
 * each into a synthetic inline-image entry. These are embedded directly in
 * the HTML and never surface as Nylas attachments, so they have to be
 * extracted here.
 */
export function extractBodyDataUriImages(html: string): InlineBodyImage[] {
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
  calendarContext?: string | null
}): string {
  const { subject, senders, recipients, bodyText, calendarContext } = args
  const truncated =
    bodyText.length > 60_000
      ? `${bodyText.slice(0, 60_000)}\n\n[...truncated, ${bodyText.length - 60_000} additional characters omitted]`
      : bodyText

  const lines = [
    `Subject: ${subject}`,
    `From: ${senders.join(", ") || "(unknown)"}`,
    `To: ${recipients.join(", ") || "(unknown)"}`,
    "",
    "--- BEGIN MESSAGE BODY ---",
    truncated || "(empty body)",
    "--- END MESSAGE BODY ---",
  ]

  // A calendar invite carries its own roster + topic. Inject it so the model
  // extracts organisations/people even when the email has no human body, and
  // tell it explicitly NOT to junk the message.
  if (calendarContext && calendarContext.trim()) {
    lines.push(
      "",
      "--- BEGIN CALENDAR INVITE (.ics) ---",
      calendarContext.trim(),
      "--- END CALENDAR INVITE (.ics) ---",
      "",
      "This email carries a calendar meeting invitation. It is business-relevant content, not noise: set relevance.isJunk = false. Extract the organisations + people involved from BOTH the invite details above and any message body.",
    )
  }

  return lines.join("\n")
}

/**
 * Prepend a deterministic `## Meeting` section to the email body markdown.
 * For a bare invite (empty body, or the "(filtered)" placeholder) the meeting
 * section becomes the entire content. Shared by the email parsers so the
 * invite is folded into the same item rather than dropped or split off.
 */
export function mergeMeetingIntoContent(
  contentMarkdown: string,
  event: CalendarEvent,
): string {
  const section = buildMeetingSection(event)
  const body = (contentMarkdown ?? "").trim()
  if (!body || body === "(filtered)") return section
  return `${section}\n\n${body}`
}

export function htmlToPlainText(html: string): string {
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
