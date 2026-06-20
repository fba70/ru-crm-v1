import "server-only"

import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  source,
  sourceItem,
  type ParseStatus,
  type SourceItemKind,
  type OrgAttribution,
} from "@/db/schema"
import type { MetadataAnalysis } from "@/server/parsers/_shared"
import {
  loadOwnOrgIdentity,
  getOrgIdentity,
  type OwnOrgIdentity,
} from "@/server/org-identity"
import {
  extractAuthorEmails,
  resolveOrgAttribution,
  type OrgAttributionResult,
} from "@/server/parsers/org-attribution"
import { companyMatchKey } from "@/lib/translit-ru"
import { extractWebsiteDomain } from "@/lib/email-domain"
import nylas from "@/lib/nylas"
import { downloadChatAttachmentBytes } from "@/lib/google-chat"
import {
  parseEmailMessage,
  EmailFilteredError,
  type NylasAttachmentRef,
  type InlineBodyImage,
} from "@/server/parsers/text"
import { parseImapMessage, type ImapAttachment } from "@/server/parsers/imap"
import { parseChatMessage, type ChatAttachmentRef } from "@/server/parsers/chat"
import { parseWhatsAppGroup } from "@/server/parsers/whatsapp"
import { parseTelegramMessage } from "@/server/parsers/telegram"
import { parseDriveFile } from "@/server/parsers/drive"
import { parsePdfBytes, PdfTooLargeError } from "@/server/parsers/pdf"
import {
  parseImageBytes,
  isSupportedImageType,
  ImageTooLargeError,
  UnsupportedImageTypeError,
} from "@/server/parsers/image"
import {
  parseAudioBytes,
  isSupportedAudioType,
  AudioTooLargeError,
  UnsupportedAudioTypeError,
} from "@/server/parsers/audio"
import {
  parseVideoBytes,
  isSupportedVideoType,
  VideoTooLargeError,
  UnsupportedVideoTypeError,
} from "@/server/parsers/video"
import {
  parseOfficeBytes,
  isSupportedOfficeType,
  detectOfficeFormat,
  OfficeTooLargeError,
  UnsupportedOfficeTypeError,
} from "@/server/parsers/office"
import { getHandler } from "@/server/providers/handlers"
// These two are also called directly from provider-specific attachment
// download helpers below (Nylas attachment fetch, Chat attachment fetch)
// — those branches are already inside provider-conditional code paths,
// so the matcher call doesn't need to go through the registry dispatch.
import {
  isNylasItemMissing,
  isGoogleChatItemMissing,
} from "@/server/parsers/_provider-errors"
import {
  getNylasCredentials,
  getImapCredentials,
  getGchatCredentials,
  getGdriveCredentials,
} from "@/server/providers/credentials"
import { imapProviderConfigSchema } from "@/server/providers/handlers"
import type {
  GchatCredentials,
  NylasCredentials,
} from "@/server/providers/handlers"

const PARSER_MODEL = "google/gemini-2.5-flash"

// ── Re-parse ──────────────────────────────────────────────────────────

// Resets a root row to 'pending' and deletes its children (cascade
// handles grandchildren — `parent_source_item_id` has onDelete cascade).
// The next Parse call starts from a clean slate. R2 objects from a prior
// upload stay in the bucket; a follow-up Upload overwrites under the
// same key.
export async function reparseSourceItem(itemId: string): Promise<void> {
  const rows = await db
    .select({
      id: sourceItem.id,
      parentSourceItemId: sourceItem.parentSourceItemId,
    })
    .from(sourceItem)
    .where(eq(sourceItem.id, itemId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error(`Source item not found: ${itemId}`)
  if (row.parentSourceItemId !== null) {
    throw new Error(
      "Re-parse is only supported on root rows; child rows are recreated by re-parsing their parent",
    )
  }

  // Delete children directly. Cascade on the FK handles any grandchildren
  // (e.g. derived audio under a video attachment).
  await db
    .delete(sourceItem)
    .where(eq(sourceItem.parentSourceItemId, itemId))

  await db
    .update(sourceItem)
    .set({
      parseStatus: "pending",
      parsedAt: null,
      parserModel: null,
      parsedMarkdown: null,
      parseError: null,
      r2UploadStatus: "pending",
      r2UploadedAt: null,
      markdownR2Key: null,
      markdownR2SizeBytes: null,
      // Reset authorship so the next parse recomputes from scratch
      // (refs/org-attribution.md).
      orgAttribution: "unknown",
      // Re-parsing produces fresh metadata. Clear the unified discovery
      // stamp so the next applyDiscovery() run re-considers this row.
      discoveryScannedAt: null,
      // Same reasoning for the cards-analysis stamp — the new markdown
      // body should get re-analyzed by the next default `generateCards()`
      // run.
      cardAnalysisScannedAt: null,
      // And the deal-discovery stamp — re-parses should re-trigger deal
      // discovery the same way they re-trigger card analysis.
      dealAnalysisScannedAt: null,
    })
    .where(eq(sourceItem.id, itemId))
}

export type ParseResult = {
  parentStatus: ParseStatus
  parentMarkdownBytes: number
  childInserted: number
  childSkipped: number
  childFailed: number
  // Reason set by the catch arm when parentStatus is 'failed' or
  // 'skipped' — same string that lands on `source_item.parse_error`.
  // Surfaced here so HTTP callers can show a meaningful toast without
  // a follow-up DB read.
  parentParseError?: string
}

// Loaded once per parseSourceItem call — joins the source row so we know
// the provider, the org, and the per-source provider config.
type ParseContext = {
  itemId: string
  sourceId: string
  organizationId: string | null
  externalId: string
  provider:
    | "nylas"
    | "imap"
    | "gchat"
    | "gdrive"
    | "dropoff"
    | "whatsapp"
    | "aichat"
    | "telegram"
  threadExternalId: string | null
  sourceCreatedAt: Date | null
  parentNamespacedSourceId: string  // markdown frontmatter source_id for the parent
  sourceSystemLabel: string         // for the parser's "source_system" frontmatter
  // Frozen snapshot of source_item.metadata_json — needed by providers
  // that don't fetch their content from a remote API at parse time
  // (currently WhatsApp, which reads its conversation transcript out of
  // metadataJson.rawText). Other providers ignore this.
  metadataJson: Record<string, unknown>
  // Encrypted credentials blob from the source row. Decrypted on demand
  // by the per-provider arms via `getNylasCredentials` /
  // `getGchatCredentials` / `getGdriveCredentials`. Null for providers
  // that don't need credentials (dropoff/whatsapp/aichat).
  credentialsRef: string | null
  // The CRM owner's own identity (domains + company keys), loaded once per
  // parse. Used to strip the owner's own company out of the extracted
  // `companies` / `organizations` before they're persisted, so downstream
  // consumers (discovery, cards, deals, chat search) never see the owner's own
  // org as if it were a client. No-op when the org profile has no website/email.
  ownOrg: OwnOrgIdentity
  // The parent's org-attribution verdict, computed by `markParsed` and read by
  // `insertParsedChild` so children inherit it (an attachment of our own email
  // is ours). Mutated in-place during the parent's `markParsed`; children are
  // always inserted afterwards, so it's set by the time they read it.
  orgAttributionValue?: OrgAttribution
}

export async function parseSourceItem(itemId: string): Promise<ParseResult> {
  const ctx = await loadParseContext(itemId)

  // Mark in-flight so the table shows "Parsing…" even if the user reloads.
  await db
    .update(sourceItem)
    .set({ parseStatus: "processing", parseError: null })
    .where(eq(sourceItem.id, itemId))

  try {
    switch (ctx.provider) {
      case "nylas":
        return await parseNylasItem(ctx)
      case "imap":
        return await parseImapItem(ctx)
      case "gchat":
        return await parseGoogleChatItem(ctx)
      case "gdrive":
        return await parseGoogleDriveItem(ctx)
      case "whatsapp":
        return await parseWhatsAppItem(ctx)
      case "telegram":
        return await parseTelegramItem(ctx)
      case "dropoff":
        // Drop-off files are browser-session only and don't have parent
        // rows in source_item yet (PHASE2.md item 8). Fail loud so a
        // future caller doesn't silently no-op.
        throw new Error(
          "Drop-off items are not yet persisted as source_item rows; parse via the dropoff dialog instead",
        )
      case "aichat":
        // AI-chat sessions arrive pre-parsed at save time (Save Chat button
        // on /dashboard runs `saveChatSession()` which inserts the row
        // with parseStatus='complete' and analysis already on metadata_json).
        // The unified parse pipeline has nothing to re-run for them.
        throw new Error(
          "AI-chat session items are saved pre-parsed via the dashboard Save Chat button; nothing to re-parse",
        )
      default: {
        const _exhaustive: never = ctx.provider
        throw new Error(`Unsupported provider: ${_exhaustive}`)
      }
    }
  } catch (err) {
    // Three skip-vs-fail outcomes:
    //   • Junk filter (Nylas only): the LLM classified the email as
    //     automated/transactional. Mark skipped so it stays as audit
    //     and never re-parses (sync upserts preserve parseStatus).
    //   • Provider deletion: the row exists in our DB but was deleted
    //     at the provider — same skip semantics.
    //   • Anything else: failed, with the raw error message.
    let status: ParseStatus
    let reason: string
    if (err instanceof EmailFilteredError) {
      status = "skipped"
      reason = `filtered: ${err.category} — ${err.classifierReason}`
    } else if (getHandler(ctx.provider).isItemMissing?.(err) ?? false) {
      status = "skipped"
      reason = "Source item no longer exists at provider"
    } else {
      status = "failed"
      reason = err instanceof Error ? err.message : String(err)
    }

    await db
      .update(sourceItem)
      .set({
        parseStatus: status,
        parseError: reason,
        parsedAt: new Date(),
      })
      .where(eq(sourceItem.id, itemId))
    return {
      parentStatus: status,
      parentMarkdownBytes: 0,
      childInserted: 0,
      childSkipped: 0,
      childFailed: 0,
      parentParseError: reason,
    }
  }
}

async function loadParseContext(itemId: string): Promise<ParseContext> {
  const rows = await db
    .select({
      id: sourceItem.id,
      sourceId: sourceItem.sourceId,
      organizationId: sourceItem.organizationId,
      externalId: sourceItem.externalId,
      threadExternalId: sourceItem.threadExternalId,
      sourceCreatedAt: sourceItem.sourceCreatedAt,
      parseStatus: sourceItem.parseStatus,
      provider: source.provider,
      metadataJson: sourceItem.metadataJson,
      credentialsRef: source.credentialsRef,
    })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(eq(sourceItem.id, itemId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error(`Source item not found: ${itemId}`)
  if (row.parseStatus === "complete") {
    throw new Error(
      "Source item is already parsed — use the Re-parse action to start over",
    )
  }

  // Namespaced source IDs as used by the parsers in their YAML
  // frontmatter (kept stable so the markdown corpus has consistent
  // cross-references).
  const namespaced = (() => {
    switch (row.provider) {
      case "nylas":
        return `nylas:${row.externalId}`
      case "imap":
        // externalId is "<uidValidity>:<uid>".
        return `imap:${row.externalId}`
      case "gchat": {
        // externalId is full "spaces/X/messages/Y"; the message id is the
        // trailing segment.
        const last = row.externalId.split("/").pop() ?? row.externalId
        return `gchat:${last}`
      }
      case "gdrive":
        return `drive:${row.externalId}`
      case "dropoff":
        return `dropoff:${row.externalId}`
      case "whatsapp":
        return `whatsapp:${row.externalId}`
      case "aichat":
        // externalId is already `aichat:<sessionId>`; pass through.
        return row.externalId
      case "telegram":
        // externalId is `<chat_id>:<message_id>`.
        return `telegram:${row.externalId}`
    }
  })()

  const sourceSystemLabel = (() => {
    switch (row.provider) {
      case "nylas":
        return "Email"
      case "imap":
        return "Email"
      case "gchat":
        return "Google Chat"
      case "gdrive":
        return "Google Drive"
      case "dropoff":
        return "Dropped File"
      case "whatsapp":
        return "WhatsApp"
      case "aichat":
        return "AI Chat"
      case "telegram":
        return "Telegram"
    }
  })()

  return {
    itemId: row.id,
    sourceId: row.sourceId,
    organizationId: row.organizationId,
    externalId: row.externalId,
    provider: row.provider,
    threadExternalId: row.threadExternalId,
    sourceCreatedAt: row.sourceCreatedAt,
    parentNamespacedSourceId: namespaced,
    sourceSystemLabel,
    metadataJson: (row.metadataJson as Record<string, unknown> | null) ?? {},
    credentialsRef: row.credentialsRef,
    ownOrg: await loadOwnOrgIdentity(row.organizationId),
  }
}

/**
 * Strip the CRM owner's own company out of the LLM-extracted `companies` /
 * `organizations` before persisting. Emails are usually addressed TO the
 * owner's mailbox, so the parser often lists the owner's own org as a
 * "company" — which then pollutes client discovery, cards, deals, and chat
 * search. We drop own-company entries entirely, and for any organisation whose
 * NAME is external but whose `webUrl` resolved to the owner's own domain (the
 * parser sometimes attributes the recipient domain to the company the email is
 * about) we blank just the URL and keep the company. No-op when the org has no
 * configured identity. Mirrors the discovery-side own-org guard.
 */
function filterAnalysisOwnOrg(
  analysis: MetadataAnalysis,
  ownOrg: OwnOrgIdentity,
): MetadataAnalysis {
  if (!ownOrg.hasIdentity) return analysis

  const companies = (analysis.companies ?? []).filter(
    (c) => !ownOrg.isOwnCompanyKey(companyMatchKey(c)),
  )

  const next: MetadataAnalysis = { ...analysis, companies }

  if (Array.isArray(analysis.organizations)) {
    next.organizations = analysis.organizations
      .filter((o) => !ownOrg.isOwnCompanyKey(companyMatchKey(o.name ?? "")))
      .map((o) => {
        const d = o.webUrl ? extractWebsiteDomain(o.webUrl) : ""
        return d && ownOrg.isOwnDomain(d) ? { ...o, webUrl: "" } : o
      })
  }

  return next
}

// ── Nylas (email) ─────────────────────────────────────────────────────

async function parseNylasItem(ctx: ParseContext): Promise<ParseResult> {
  const creds = getNylasCredentials(ctx.sourceId, ctx.credentialsRef)
  const parsed = await parseEmailMessage(ctx.externalId, creds)

  // Parent row → complete with markdown.
  await markParsed(ctx, parsed.markdown, parsed.analysis)

  let inserted = 0
  let skipped = 0
  let failed = 0

  // Nylas attachments (real files, including CID-inline images flagged
  // isInline). Each parsed independently; one failure doesn't block the
  // others.
  for (const ref of parsed.attachments) {
    const result = await parseNylasAttachment(ref, ctx, creds)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
  }

  // Body data-URI images — already-decoded bytes, no Nylas roundtrip.
  for (let i = 0; i < parsed.bodyInlineImages.length; i++) {
    const img = parsed.bodyInlineImages[i]
    const result = await parseNylasInlineImage(img, i, ctx)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
  }

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted: inserted,
    childSkipped: skipped,
    childFailed: failed,
  }
}

async function parseNylasAttachment(
  ref: NylasAttachmentRef,
  ctx: ParseContext,
  creds: NylasCredentials,
): Promise<ChildOutcome> {
  const attSourceId = `nylas-att:${ctx.externalId}:${ref.attachmentId}`
  const meta = {
    fileName: ref.filename,
    contentType: ref.contentType,
    byteSize: ref.size,
  }

  const kind = detectAttachmentKind(ref.contentType, ref.filename)
  if (!kind) {
    await insertSkippedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: "unsupported type",
    })
    return { inserted: 0, skipped: 1, failed: 0 }
  }

  let bytes: Uint8Array
  try {
    const buffer = await nylas.attachments.downloadBytes({
      identifier: creds.grantId,
      attachmentId: ref.attachmentId,
      queryParams: { messageId: ctx.externalId },
    })
    bytes = new Uint8Array(buffer)
  } catch (err) {
    if (isNylasItemMissing(err)) {
      await insertSkippedChild({
        ctx,
        externalId: attSourceId,
        externalType: "attachment",
        meta,
        reason: "no longer exists at provider",
      })
      return { inserted: 0, skipped: 1, failed: 0 }
    }
    await insertFailedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: err instanceof Error ? err.message : String(err),
    })
    return { inserted: 0, skipped: 0, failed: 1 }
  }

  return runAttachmentParser({
    ctx,
    kind,
    bytes,
    attSourceId,
    externalType: "attachment",
    meta,
  })
}

async function parseNylasInlineImage(
  img: InlineBodyImage,
  index: number,
  ctx: ParseContext,
): Promise<ChildOutcome> {
  const sid = `nylas-inline:${ctx.externalId}:${index}`
  const meta = {
    fileName: img.filename,
    contentType: img.mediaType,
    byteSize: img.bytes.byteLength,
  }
  try {
    const result = await parseImageBytes({
      bytes: img.bytes,
      fileName: img.filename,
      mediaType: img.mediaType,
      sourceId: sid,
      parentSourceId: ctx.parentNamespacedSourceId,
      sourceSystem: ctx.sourceSystemLabel,
      threadId: ctx.threadExternalId,
      sourceCreatedAt: isoOrNull(ctx.sourceCreatedAt),
      sourceReceivedAt: isoOrNull(ctx.sourceCreatedAt),
    })
    await insertParsedChild({
      ctx,
      externalId: sid,
      externalType: "inline_image",
      meta,
      markdown: result.markdown,
      analysis: result.analysis,
    })
    return { inserted: 1, skipped: 0, failed: 0 }
  } catch (err) {
    return classifyAndInsertChildError({
      ctx,
      externalId: sid,
      externalType: "inline_image",
      meta,
      err,
    })
  }
}

// ── IMAP (email) ──────────────────────────────────────────────────────

async function parseImapItem(ctx: ParseContext): Promise<ParseResult> {
  const creds = getImapCredentials(ctx.sourceId, ctx.credentialsRef)
  // The mailbox folder is denormalised onto each item's metadata_json at
  // sync time (defaults to INBOX if absent on an old row).
  const { mailbox } = imapProviderConfigSchema.parse(ctx.metadataJson)

  const parsed = await parseImapMessage({
    externalId: ctx.externalId,
    mailbox,
    namespacedSourceId: ctx.parentNamespacedSourceId,
    creds,
  })

  // Parent row → complete with markdown.
  await markParsed(ctx, parsed.markdown, parsed.analysis)

  let inserted = 0
  let skipped = 0
  let failed = 0

  // Real attachments — bytes already in hand (mailparser), so no per-file
  // download (unlike Nylas).
  for (let i = 0; i < parsed.attachments.length; i++) {
    const result = await parseImapAttachment(parsed.attachments[i], i, ctx)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
  }

  // Inline (cid:) images that mailparser folded into the HTML as data: URIs.
  for (let i = 0; i < parsed.bodyInlineImages.length; i++) {
    const result = await parseImapInlineImage(parsed.bodyInlineImages[i], i, ctx)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
  }

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted: inserted,
    childSkipped: skipped,
    childFailed: failed,
  }
}

async function parseImapAttachment(
  att: ImapAttachment,
  index: number,
  ctx: ParseContext,
): Promise<ChildOutcome> {
  const attSourceId = `imap-att:${ctx.externalId}:${index}`
  const meta = {
    fileName: att.filename,
    contentType: att.contentType,
    byteSize: att.bytes.byteLength,
  }

  const kind = detectAttachmentKind(att.contentType, att.filename)
  if (!kind) {
    await insertSkippedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: "unsupported type",
    })
    return { inserted: 0, skipped: 1, failed: 0 }
  }

  return runAttachmentParser({
    ctx,
    kind,
    bytes: att.bytes,
    attSourceId,
    externalType: "attachment",
    meta,
  })
}

async function parseImapInlineImage(
  img: InlineBodyImage,
  index: number,
  ctx: ParseContext,
): Promise<ChildOutcome> {
  const sid = `imap-inline:${ctx.externalId}:${index}`
  const meta = {
    fileName: img.filename,
    contentType: img.mediaType,
    byteSize: img.bytes.byteLength,
  }
  try {
    const result = await parseImageBytes({
      bytes: img.bytes,
      fileName: img.filename,
      mediaType: img.mediaType,
      sourceId: sid,
      parentSourceId: ctx.parentNamespacedSourceId,
      sourceSystem: ctx.sourceSystemLabel,
      threadId: ctx.threadExternalId,
      sourceCreatedAt: isoOrNull(ctx.sourceCreatedAt),
      sourceReceivedAt: isoOrNull(ctx.sourceCreatedAt),
    })
    await insertParsedChild({
      ctx,
      externalId: sid,
      externalType: "inline_image",
      meta,
      markdown: result.markdown,
      analysis: result.analysis,
    })
    return { inserted: 1, skipped: 0, failed: 0 }
  } catch (err) {
    return classifyAndInsertChildError({
      ctx,
      externalId: sid,
      externalType: "inline_image",
      meta,
      err,
    })
  }
}

// ── Google Chat ───────────────────────────────────────────────────────

async function parseGoogleChatItem(ctx: ParseContext): Promise<ParseResult> {
  const creds = getGchatCredentials(ctx.sourceId, ctx.credentialsRef)
  // parseChatMessage takes the full resource path "spaces/X/messages/Y";
  // sync stores the same in externalId.
  const parsed = await parseChatMessage(ctx.externalId, creds)

  await markParsed(ctx, parsed.markdown, parsed.analysis)

  let inserted = 0
  let skipped = 0
  let failed = 0
  for (const ref of parsed.attachments) {
    const result = await parseChatAttachment(ref, ctx, creds)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
  }
  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted: inserted,
    childSkipped: skipped,
    childFailed: failed,
  }
}

async function parseChatAttachment(
  ref: ChatAttachmentRef,
  ctx: ParseContext,
  creds: GchatCredentials,
): Promise<ChildOutcome> {
  const messageId = ctx.externalId.split("/").pop() ?? ctx.externalId
  const attSourceId = `gchat-att:${messageId}:${ref.index}`
  const meta = {
    fileName: ref.filename,
    contentType: ref.contentType,
    byteSize: 0,
  }

  const kind = detectAttachmentKind(ref.contentType, ref.filename)
  if (!kind) {
    await insertSkippedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: "unsupported type",
    })
    return { inserted: 0, skipped: 1, failed: 0 }
  }

  let bytes: Uint8Array
  try {
    bytes = await downloadChatAttachmentBytes(creds, ref.resourceName)
  } catch (err) {
    if (isGoogleChatItemMissing(err)) {
      await insertSkippedChild({
        ctx,
        externalId: attSourceId,
        externalType: "attachment",
        meta,
        reason: "no longer exists at provider",
      })
      return { inserted: 0, skipped: 1, failed: 0 }
    }
    await insertFailedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: err instanceof Error ? err.message : String(err),
    })
    return { inserted: 0, skipped: 0, failed: 1 }
  }

  meta.byteSize = bytes.byteLength
  return runAttachmentParser({
    ctx,
    kind,
    bytes,
    attSourceId,
    externalType: "attachment",
    meta,
  })
}

// ── WhatsApp (chat-group rows) ────────────────────────────────────────

// WhatsApp rows arrive in Pending with the rendered transcript already
// in `metadataJson.rawText` (stamped by the upload route). Parse just
// runs the LLM metadata pass — no remote API to call, no attachment
// children to spawn here (the upload route already inserted attachment
// children inline-parsed under this row's id).
async function parseWhatsAppItem(ctx: ParseContext): Promise<ParseResult> {
  const meta = ctx.metadataJson
  const rawText = typeof meta.rawText === "string" ? meta.rawText : ""
  if (!rawText) {
    throw new Error(
      "WhatsApp chat-group row is missing metadataJson.rawText — re-upload the archive",
    )
  }
  const authors = Array.isArray(meta.authors)
    ? (meta.authors as unknown[]).filter(
        (a): a is string => typeof a === "string",
      )
    : []
  const startTimestamp =
    typeof meta.startTimestamp === "string" ? meta.startTimestamp : null
  const endTimestamp =
    typeof meta.endTimestamp === "string" ? meta.endTimestamp : null

  const parsed = await parseWhatsAppGroup({
    rawText,
    sourceId: ctx.parentNamespacedSourceId,
    threadId: ctx.threadExternalId,
    authors,
    startTimestamp,
    endTimestamp,
  })

  await markParsed(ctx, parsed.markdown, parsed.analysis)

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted: 0,
    childSkipped: 0,
    childFailed: 0,
  }
}

// ── Telegram (DM text rows) ───────────────────────────────────────────

// Telegram rows arrive in Pending with the message body already in
// `metadata_json.rawText` (stamped by the webhook ingest). Like WhatsApp,
// parse is a pure local render + one LLM metadata pass — no remote API to
// call. Phase 1 produces no children (attachments land in Phase 2).
async function parseTelegramItem(ctx: ParseContext): Promise<ParseResult> {
  const meta = ctx.metadataJson
  const rawText = typeof meta.rawText === "string" ? meta.rawText : ""
  if (!rawText) {
    throw new Error(
      "Telegram message row is missing metadata_json.rawText — re-ingest the message",
    )
  }
  const sender = Array.isArray(meta.senders)
    ? (meta.senders as unknown[]).find(
        (s): s is string => typeof s === "string" && s.length > 0,
      ) ?? "Telegram user"
    : "Telegram user"

  const parsed = await parseTelegramMessage({
    rawText,
    sourceId: ctx.parentNamespacedSourceId,
    sender,
    threadId: ctx.threadExternalId,
    sourceCreatedAt: ctx.sourceCreatedAt
      ? ctx.sourceCreatedAt.toISOString()
      : null,
  })

  await markParsed(ctx, parsed.markdown, parsed.analysis)

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted: 0,
    childSkipped: 0,
    childFailed: 0,
  }
}

// ── Google Drive ──────────────────────────────────────────────────────

async function parseGoogleDriveItem(ctx: ParseContext): Promise<ParseResult> {
  const creds = getGdriveCredentials(ctx.sourceId, ctx.credentialsRef)
  const parsed = await parseDriveFile(ctx.externalId, creds)
  // First block is the body (the file itself); video files emit a
  // second block (audio transcript) that becomes a child.
  if (parsed.blocks.length === 0) {
    throw new Error("Drive parser returned no blocks")
  }

  const bodyBlock = parsed.blocks[0]
  await markParsed(ctx, bodyBlock.markdown, bodyBlock.analysis)

  let inserted = 0
  for (let i = 1; i < parsed.blocks.length; i++) {
    const extra = parsed.blocks[i]
    const childExternalId = `drive:${ctx.externalId}:${extra.kind === "video_audio" ? "audio" : `extra-${i}`}`
    await insertParsedChild({
      ctx,
      externalId: childExternalId,
      externalType: extra.kind === "video_audio" ? "derived_audio" : "attachment",
      meta: {
        fileName: parsed.fileName,
        contentType: extra.kind === "video_audio" ? "audio/mp4" : parsed.mimeType,
        byteSize: 0,
      },
      markdown: extra.markdown,
      analysis: extra.analysis,
    })
    inserted++
  }

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(bodyBlock.markdown),
    childInserted: inserted,
    childSkipped: 0,
    childFailed: 0,
  }
}

// ── Shared attachment parser dispatch ────────────────────────────────

type ChildOutcome = { inserted: number; skipped: number; failed: number }

type AttachmentMeta = {
  fileName: string
  contentType: string
  byteSize: number
}

type RunAttachmentInput = {
  ctx: ParseContext
  kind: "pdf" | "image" | "audio" | "video" | "office"
  bytes: Uint8Array
  attSourceId: string
  externalType: SourceItemKind
  meta: AttachmentMeta
}

async function runAttachmentParser(
  input: RunAttachmentInput,
): Promise<ChildOutcome> {
  const { ctx, kind, bytes, attSourceId, externalType, meta } = input
  const commonInput = {
    sourceId: attSourceId,
    parentSourceId: ctx.parentNamespacedSourceId,
    sourceSystem: ctx.sourceSystemLabel,
    threadId: ctx.threadExternalId,
    sourceCreatedAt: isoOrNull(ctx.sourceCreatedAt),
    sourceReceivedAt: isoOrNull(ctx.sourceCreatedAt),
  }

  try {
    if (kind === "pdf") {
      const r = await parsePdfBytes({
        ...commonInput,
        bytes,
        fileName: meta.fileName,
      })
      await insertParsedChild({
        ctx,
        externalId: attSourceId,
        externalType,
        meta,
        markdown: r.markdown,
        analysis: r.analysis,
      })
      return { inserted: 1, skipped: 0, failed: 0 }
    }
    if (kind === "audio") {
      const r = await parseAudioBytes({
        ...commonInput,
        bytes,
        fileName: meta.fileName,
        mediaType: resolveMediaType(meta.contentType, "audio/mpeg"),
      })
      await insertParsedChild({
        ctx,
        externalId: attSourceId,
        externalType,
        meta,
        markdown: r.markdown,
        analysis: r.analysis,
      })
      return { inserted: 1, skipped: 0, failed: 0 }
    }
    if (kind === "video") {
      const audioSourceId = `${attSourceId}:audio`
      const r = await parseVideoBytes({
        bytes,
        fileName: meta.fileName,
        mediaType: resolveMediaType(meta.contentType, "video/mp4"),
        sourceSystem: ctx.sourceSystemLabel,
        threadId: ctx.threadExternalId,
        sourceCreatedAt: isoOrNull(ctx.sourceCreatedAt),
        sourceReceivedAt: isoOrNull(ctx.sourceCreatedAt),
        videoSourceId: attSourceId,
        videoParentSourceId: ctx.parentNamespacedSourceId,
        audioSourceId,
        // The audio block's parent is the video, not the email/chat.
        audioParentSourceId: attSourceId,
      })
      // Insert the video block first so it can be referenced as the
      // parent of the audio derivation.
      const videoChildId = await insertParsedChild({
        ctx,
        externalId: attSourceId,
        externalType,
        meta,
        markdown: r.videoMarkdown,
        analysis: r.videoAnalysis,
      })
      await insertParsedChild({
        ctx,
        externalId: audioSourceId,
        externalType: "derived_audio",
        meta: { ...meta, contentType: "audio/mp4" },
        markdown: r.audioMarkdown,
        analysis: r.audioAnalysis,
        parentSourceItemIdOverride: videoChildId,
      })
      return { inserted: 2, skipped: 0, failed: 0 }
    }
    if (kind === "office") {
      const format = detectOfficeFormat(meta.contentType, meta.fileName)
      if (!format) {
        await insertSkippedChild({
          ctx,
          externalId: attSourceId,
          externalType,
          meta,
          reason: "unsupported type",
        })
        return { inserted: 0, skipped: 1, failed: 0 }
      }
      const r = await parseOfficeBytes({
        ...commonInput,
        bytes,
        fileName: meta.fileName,
        mediaType: resolveMediaType(
          meta.contentType,
          format === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
      })
      await insertParsedChild({
        ctx,
        externalId: attSourceId,
        externalType,
        meta,
        markdown: r.markdown,
        analysis: r.analysis,
      })
      return { inserted: 1, skipped: 0, failed: 0 }
    }
    // image
    const r = await parseImageBytes({
      ...commonInput,
      bytes,
      fileName: meta.fileName,
      mediaType: resolveMediaType(
        meta.contentType,
        inferImageMediaType(meta.fileName),
      ),
    })
    await insertParsedChild({
      ctx,
      externalId: attSourceId,
      externalType,
      meta,
      markdown: r.markdown,
      analysis: r.analysis,
    })
    return { inserted: 1, skipped: 0, failed: 0 }
  } catch (err) {
    return classifyAndInsertChildError({
      ctx,
      externalId: attSourceId,
      externalType,
      meta,
      err,
    })
  }
}

async function classifyAndInsertChildError(args: {
  ctx: ParseContext
  externalId: string
  externalType: SourceItemKind
  meta: AttachmentMeta
  err: unknown
}): Promise<ChildOutcome> {
  const { err } = args
  if (
    err instanceof PdfTooLargeError ||
    err instanceof ImageTooLargeError ||
    err instanceof AudioTooLargeError ||
    err instanceof VideoTooLargeError ||
    err instanceof OfficeTooLargeError
  ) {
    await insertSkippedChild({
      ...args,
      reason: `too large (${err.message})`,
    })
    return { inserted: 0, skipped: 1, failed: 0 }
  }
  if (
    err instanceof UnsupportedImageTypeError ||
    err instanceof UnsupportedAudioTypeError ||
    err instanceof UnsupportedVideoTypeError ||
    err instanceof UnsupportedOfficeTypeError
  ) {
    await insertSkippedChild({ ...args, reason: "unsupported type" })
    return { inserted: 0, skipped: 1, failed: 0 }
  }
  await insertFailedChild({
    ...args,
    reason: err instanceof Error ? err.message : String(err),
  })
  return { inserted: 0, skipped: 0, failed: 1 }
}

// ── DB writes ────────────────────────────────────────────────────────

// Parents only — classify authorship (refs/org-attribution.md). Bails to
// `unknown` with no org. The deterministic path short-circuits for email/chat
// with a resolvable sender; only ambiguous documents reach the LLM judge.
async function computeOrgAttribution(
  ctx: ParseContext,
  markdown: string,
): Promise<OrgAttributionResult> {
  if (!ctx.organizationId) {
    return { value: "unknown", confidence: "low", matchedOn: [], reason: "No organization" }
  }
  const orgIdentity = await getOrgIdentity(ctx.organizationId)
  const authorEmails = extractAuthorEmails(ctx.metadataJson, ctx.provider)
  return resolveOrgAttribution({
    authorEmails,
    contentHaystack: markdown,
    orgIdentity,
    organizationId: ctx.organizationId,
    // WhatsApp transcripts are conversational — authorship is meaningless, so
    // never pay for the judge there.
    enableLlmJudge: ctx.provider !== "whatsapp",
  })
}

async function markParsed(
  ctx: ParseContext,
  markdown: string,
  analysis: MetadataAnalysis,
): Promise<void> {
  const cleaned = filterAnalysisOwnOrg(analysis, ctx.ownOrg)
  const attribution = await computeOrgAttribution(ctx, markdown)
  // Children created after this read inherit the verdict via ctx.
  ctx.orgAttributionValue = attribution.value
  // Merge the LLM analysis (+ the attribution evidence) into the existing
  // metadata_json (which holds provider-shape sync fields like
  // subject/snippet/from/to). jsonb `||` is right-biased so analysis keys
  // overwrite any colliding sync keys (none today, but defensive).
  const merged = { ...cleaned, orgAttribution: attribution }
  await db
    .update(sourceItem)
    .set({
      parseStatus: "complete",
      parsedAt: new Date(),
      parserModel: PARSER_MODEL,
      parsedMarkdown: markdown,
      parseError: null,
      orgAttribution: attribution.value,
      metadataJson: sql`COALESCE(${sourceItem.metadataJson}, '{}'::jsonb) || ${JSON.stringify(merged)}::jsonb`,
    })
    .where(eq(sourceItem.id, ctx.itemId))
}

async function insertParsedChild(args: {
  ctx: ParseContext
  externalId: string
  externalType: SourceItemKind
  meta: AttachmentMeta
  markdown: string
  analysis: MetadataAnalysis
  parentSourceItemIdOverride?: string
}): Promise<string> {
  const id = randomUUID()
  const now = new Date()
  const cleaned = filterAnalysisOwnOrg(args.analysis, args.ctx.ownOrg)
  // Children are synthesized rows — they have no provider sync metadata to
  // preserve, so we write the analysis as the entire metadata_json.
  await db
    .insert(sourceItem)
    .values({
      id,
      sourceId: args.ctx.sourceId,
      organizationId: args.ctx.organizationId,
      externalId: args.externalId,
      externalType: args.externalType,
      parentSourceItemId: args.parentSourceItemIdOverride ?? args.ctx.itemId,
      threadExternalId: args.ctx.threadExternalId,
      filename: args.meta.fileName,
      mimeType: args.meta.contentType,
      sizeBytes: args.meta.byteSize || null,
      sourceCreatedAt: args.ctx.sourceCreatedAt,
      fetchedAt: now,
      parseStatus: "complete",
      parsedAt: now,
      parserModel: PARSER_MODEL,
      parsedMarkdown: args.markdown,
      // Children inherit the parent's authorship verdict (set on ctx during the
      // parent's markParsed, which always runs before children are inserted).
      orgAttribution: args.ctx.orgAttributionValue ?? "unknown",
      metadataJson: cleaned,
    })
    .onConflictDoUpdate({
      target: [sourceItem.sourceId, sourceItem.externalId],
      set: {
        parseStatus: "complete",
        parsedAt: now,
        parserModel: PARSER_MODEL,
        parsedMarkdown: args.markdown,
        parseError: null,
        filename: args.meta.fileName,
        mimeType: args.meta.contentType,
        sizeBytes: args.meta.byteSize || null,
        orgAttribution: args.ctx.orgAttributionValue ?? "unknown",
        metadataJson: sql`COALESCE(${sourceItem.metadataJson}, '{}'::jsonb) || ${JSON.stringify(cleaned)}::jsonb`,
      },
    })
  return id
}

async function insertSkippedChild(args: {
  ctx: ParseContext
  externalId: string
  externalType: SourceItemKind
  meta: AttachmentMeta
  reason: string
}): Promise<void> {
  await insertChildWithStatus(args, "skipped", args.reason)
}

async function insertFailedChild(args: {
  ctx: ParseContext
  externalId: string
  externalType: SourceItemKind
  meta: AttachmentMeta
  reason: string
}): Promise<void> {
  await insertChildWithStatus(args, "failed", args.reason)
}

async function insertChildWithStatus(
  args: {
    ctx: ParseContext
    externalId: string
    externalType: SourceItemKind
    meta: AttachmentMeta
  },
  status: ParseStatus,
  reason: string,
): Promise<void> {
  const id = randomUUID()
  const now = new Date()
  await db
    .insert(sourceItem)
    .values({
      id,
      sourceId: args.ctx.sourceId,
      organizationId: args.ctx.organizationId,
      externalId: args.externalId,
      externalType: args.externalType,
      parentSourceItemId: args.ctx.itemId,
      threadExternalId: args.ctx.threadExternalId,
      filename: args.meta.fileName,
      mimeType: args.meta.contentType,
      sizeBytes: args.meta.byteSize || null,
      sourceCreatedAt: args.ctx.sourceCreatedAt,
      fetchedAt: now,
      parseStatus: status,
      parsedAt: now,
      parseError: reason,
    })
    .onConflictDoUpdate({
      target: [sourceItem.sourceId, sourceItem.externalId],
      set: {
        parseStatus: status,
        parsedAt: now,
        parseError: reason,
      },
    })
}

// ── Helpers ──────────────────────────────────────────────────────────

function detectAttachmentKind(
  contentType: string,
  filename: string,
): "pdf" | "image" | "audio" | "video" | "office" | null {
  const ct = (contentType ?? "").toLowerCase()
  const fn = (filename ?? "").toLowerCase()
  if (ct === "application/pdf" || fn.endsWith(".pdf")) return "pdf"
  if (isSupportedVideoType(ct, fn)) return "video"
  if (isSupportedAudioType(ct, fn)) return "audio"
  if (isSupportedImageType(ct, fn)) return "image"
  if (isSupportedOfficeType(ct, fn)) return "office"
  return null
}

function resolveMediaType(contentType: string, fallback: string): string {
  return contentType && contentType !== "application/octet-stream"
    ? contentType
    : fallback
}

function inferImageMediaType(filename: string): string {
  return filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"
}

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

function byteLengthOf(s: string): number {
  return new TextEncoder().encode(s).byteLength
}
