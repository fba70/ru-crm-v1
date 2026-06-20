import "server-only"

import { simpleParser, type AddressObject } from "mailparser"
import { buildImapClient } from "@/lib/imap"
import type { ImapCredentials } from "@/server/providers/handlers"
import { ImapMessageMissingError } from "@/server/parsers/_provider-errors"
import {
  analyzeAndAssembleEmail,
  extractBodyDataUriImages,
  htmlToPlainText,
  type InlineBodyImage,
} from "@/server/parsers/text"
import {
  isIcsAttachment,
  parseIcsToEvent,
  type CalendarEvent,
} from "@/server/parsers/ics"
import { uniqueStrings, type MetadataAnalysis } from "@/server/parsers/_shared"

// A real (non-inline) attachment with its bytes already in hand — mailparser
// hands us the decoded content inline, so unlike Nylas there is no per-
// attachment download at parse time.
export type ImapAttachment = {
  filename: string
  contentType: string
  bytes: Uint8Array
}

export type ParsedImapEmail = {
  markdown: string
  analysis: MetadataAnalysis
  attachments: ImapAttachment[]
  bodyInlineImages: InlineBodyImage[]
  sourceCreatedAt: string | null
  threadId: string | null
}

type ParseImapArgs = {
  // "<uidValidity>:<uid>" — same identity stamped by sync.
  externalId: string
  // IMAP folder name (from provider_config).
  mailbox: string
  // Namespaced frontmatter source id, e.g. "imap:<externalId>".
  namespacedSourceId: string
  creds: ImapCredentials
}

// Flatten a mailparser AddressObject (or array) into lowercased email strings.
function addressEmails(
  a: AddressObject | AddressObject[] | undefined,
): string[] {
  if (!a) return []
  const arr = Array.isArray(a) ? a : [a]
  return arr
    .flatMap((o) => o.value.map((v) => (v.address ?? "").toLowerCase()))
    .filter(Boolean)
}

/**
 * Parse one IMAP message. Reconnects, RE-VERIFIES UIDVALIDITY (the load-
 * bearing correctness invariant — a server renumber invalidates every stored
 * UID), fetches the full RFC822 lazily, then runs the SHARED Nylas email LLM
 * pipeline (`analyzeAndAssembleEmail`) so IMAP and Nylas produce identical
 * markdown + analysis. A since-deleted message (or a UIDVALIDITY change)
 * throws `ImapMessageMissingError` → row marked `skipped`, not `failed`.
 */
export async function parseImapMessage(
  args: ParseImapArgs,
): Promise<ParsedImapEmail> {
  const { externalId, mailbox, namespacedSourceId, creds } = args

  const sep = externalId.indexOf(":")
  const uidValidityStr = sep >= 0 ? externalId.slice(0, sep) : ""
  const uid = Number.parseInt(sep >= 0 ? externalId.slice(sep + 1) : "", 10)
  if (!uidValidityStr || !Number.isFinite(uid)) {
    throw new ImapMessageMissingError(`malformed external id "${externalId}"`)
  }

  const client = buildImapClient(creds)
  let rawSource: Buffer
  await client.connect()
  try {
    const mb = await client.mailboxOpen(mailbox, { readOnly: true })
    if (mb.uidValidity.toString() !== uidValidityStr) {
      // The mailbox was renumbered since sync — our stored UID may now point
      // at a different message. Skip rather than risk parsing the wrong one.
      throw new ImapMessageMissingError(
        `UIDVALIDITY changed (stored ${uidValidityStr}, now ${mb.uidValidity})`,
      )
    }
    const msg = await client.fetchOne(
      String(uid),
      { source: true },
      { uid: true },
    )
    if (!msg || !msg.source) {
      throw new ImapMessageMissingError(`uid ${uid} not found in ${mailbox}`)
    }
    rawSource = msg.source
  } finally {
    try {
      await client.logout()
    } catch {
      // best-effort
    }
  }

  const mail = await simpleParser(rawSource)

  const subject = mail.subject ?? "(no subject)"
  const senders = uniqueStrings(addressEmails(mail.from))
  const recipients = uniqueStrings([
    ...addressEmails(mail.to),
    ...addressEmails(mail.cc),
    ...addressEmails(mail.bcc),
  ])
  const bodyHtml = typeof mail.html === "string" ? mail.html : ""
  const bodyText =
    mail.text && mail.text.trim() ? mail.text : htmlToPlainText(bodyHtml)
  const sourceCreatedAt = mail.date ? mail.date.toISOString() : null
  const threadId = mail.inReplyTo ?? null

  // Calendar (.ics) invite folded into THIS email (metadata + markdown) — the
  // bytes are already inline, no download. Best-effort.
  const calendarEvent = extractCalendarEvent(mail.attachments)

  const { markdown, analysis } = await analyzeAndAssembleEmail({
    sourceId: namespacedSourceId,
    sourceSystem: "Email",
    subject,
    senders,
    recipients,
    bodyHtml,
    bodyText,
    sourceCreatedAt,
    threadId,
    calendarEvent,
  })

  // Real file attachments only. `related` attachments are inline (cid:)
  // images that mailparser has already converted to data: URIs inside the
  // HTML body, so they're picked up by extractBodyDataUriImages below —
  // including them here too would double-parse. The `.ics` is excluded
  // (already folded into the parent).
  const attachments: ImapAttachment[] = mail.attachments
    .filter((a) => !a.related)
    .filter((a) => !isIcsAttachment(a.contentType, a.filename))
    .filter((a) => Buffer.isBuffer(a.content) && a.content.byteLength > 0)
    .map((a) => ({
      filename: a.filename ?? "unknown",
      contentType: a.contentType ?? "application/octet-stream",
      bytes: new Uint8Array(a.content as Buffer),
    }))

  const bodyInlineImages = extractBodyDataUriImages(bodyHtml)

  return {
    markdown,
    analysis,
    attachments,
    bodyInlineImages,
    sourceCreatedAt,
    threadId,
  }
}

// Decode the first iCalendar attachment carried by the message. mailparser
// hands the bytes inline, so this is synchronous. Returns null when there's
// no .ics or it's unparseable — never throws.
function extractCalendarEvent(
  attachments: Array<{
    filename?: string
    contentType?: string
    content?: unknown
  }>,
): CalendarEvent | null {
  const ics = attachments.find(
    (a) =>
      Buffer.isBuffer(a.content) &&
      isIcsAttachment(a.contentType, a.filename),
  )
  if (!ics || !Buffer.isBuffer(ics.content)) return null
  return parseIcsToEvent(new Uint8Array(ics.content))
}
