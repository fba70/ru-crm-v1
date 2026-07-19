// Telegram push-ingestion. This is the org-UNSCOPED entry point that the
// public webhook route delegates to — the capability is the opaque
// `sourceId` in the URL path PLUS the per-source secret echoed in the
// `X-Telegram-Bot-Api-Secret-Token` header. There is no session here
// (Telegram is the caller), so tenant scope comes structurally from the
// source row the path resolves to: each org runs its own bot, the bot IS
// the tenant. Mirrors the guest order-link posture (token = authorization).
//
// Not "use server" — exports a plain type alongside async fns and is only
// reached from the webhook route + the credential-save side-effect.
import "server-only"

import { timingSafeEqual } from "node:crypto"
import { eq } from "drizzle-orm"
import type { Message, Update } from "grammy/types"
import { db } from "@/db/drizzle"
import { source } from "@/db/schema"
import { getTelegramCredentials } from "@/server/providers/credentials"
import { upsertSourceItem } from "@/server/source-items"
import { parseSourceItem } from "@/server/parse-source-item"
import { uploadSourceItem } from "@/server/r2/upload-source-item"
import {
  getTelegramUpdates,
  isTelegramWebhookConflict,
  sendTelegramAck,
  setTelegramWebhook,
  telegramAppOrigin,
  telegramWebhookUrl,
} from "@/lib/telegram"

// Resolved per-request context for a telegram webhook delivery. Loaded
// strictly by `grant`-style path id — never trusts anything in the update
// body for tenant scope.
export type TelegramWebhookContext = {
  sourceId: string
  organizationId: string | null
  botToken: string
  webhookSecret: string
  botUsername: string | null
}

// Load the source the webhook path points at and decrypt its bot creds.
// Returns null when the source doesn't exist, isn't a telegram source, or
// is inactive — the route turns that into a 404 without leaking which.
export async function resolveTelegramWebhookContext(
  sourceId: string,
): Promise<TelegramWebhookContext | null> {
  const rows = await db
    .select({
      id: source.id,
      provider: source.provider,
      status: source.status,
      organizationId: source.ownerOrganizationId,
      providerConfig: source.providerConfig,
      credentialsRef: source.credentialsRef,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row || row.provider !== "telegram" || row.status !== "active") {
    return null
  }

  // Throws MissingCredentialsError / InvalidCredentialsError if the row
  // isn't configured — the route maps that to a 503 so Telegram retries
  // once the owner configures the bot, rather than dropping the update.
  const { botToken, webhookSecret } = getTelegramCredentials(
    sourceId,
    row.credentialsRef,
  )
  const cfg = (row.providerConfig as Record<string, unknown> | null) ?? {}
  const botUsername =
    typeof cfg.botUsername === "string" ? cfg.botUsername : null

  return {
    sourceId,
    organizationId: row.organizationId,
    botToken,
    webhookSecret,
    botUsername,
  }
}

// Constant-time compare of the secret Telegram echoed back. Length-guarded
// so timingSafeEqual doesn't throw on a mismatched-length forgery.
export function verifyTelegramSecret(
  expected: string,
  received: string | null,
): boolean {
  if (!received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

type PersistResult =
  | {
      outcome: "ingested"
      itemId: string
      inserted: boolean
      chatId: number
      // "voice" → media item that still needs transcription; "text" → body
      // already in hand. Drives the wording of the chat acknowledgement.
      kind: "text" | "voice"
    }
  | { outcome: "ignored" }

// Telegram service/system messages — the payload lives in one of these named
// fields and `message.text` is absent, so they'd already drop out at the text
// check. We reject them explicitly so the exclusion is documented and a field
// we don't read can never slip through as a blank-text source item: chat
// joins/leaves, title/photo changes, pins, group/channel creation, chat
// migrations, and the auto-delete-timer change. (List per the Telegram
// Bot API Message object.)
const SERVICE_MESSAGE_KEYS = [
  "new_chat_members",
  "left_chat_member",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "pinned_message",
  "group_chat_created",
  "supergroup_chat_created",
  "channel_chat_created",
  "migrate_to_chat_id",
  "migrate_from_chat_id",
  "message_auto_delete_timer_changed",
] as const

function isServiceMessage(message: Message): boolean {
  const m = message as unknown as Record<string, unknown>
  return SERVICE_MESSAGE_KEYS.some((k) => m[k] != null)
}

// A bot command is any message whose text starts with "/" (/start, /help,
// /settings, …) — control input for the bot, never client content. Telegram
// also tags these with a `bot_command` entity at offset 0; the leading-slash
// test is the broader, simpler rule the operator asked for.
function isBotCommand(text: string): boolean {
  return text.startsWith("/")
}

// The display name of a message sender, best-effort.
function resolveSenderName(message: Message): string {
  const from = message.from
  return (
    [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim() ||
    from?.username ||
    "Telegram user"
  )
}

// Non-secret descriptor of who sent a message — stamped onto every source
// item's metadata so the parser + downstream attribution have a sender.
function senderMetadata(message: Message): Record<string, unknown> | null {
  const from = message.from
  return from
    ? {
        id: from.id,
        isBot: from.is_bot,
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
      }
    : null
}

// A voice memo (`message.voice`, Opus-in-Ogg) or an audio file
// (`message.audio`, usually mp3/m4a). Both carry a stable `file_id` we
// re-resolve to bytes at parse time. `message.caption` (if any) rides along
// as text context for the transcript. Returns the media descriptor we persist
// into `metadata_json.telegram.media`, or null when the message has no audio.
function extractTelegramAudio(
  message: Message,
): { kind: "voice" | "audio"; fileId: string; mimeType: string; fileName: string; duration: number; fileSize: number | null } | null {
  if (message.voice) {
    const v = message.voice
    return {
      kind: "voice",
      fileId: v.file_id,
      mimeType: v.mime_type ?? "audio/ogg",
      fileName: `voice-${message.message_id}.ogg`,
      duration: v.duration,
      fileSize: v.file_size ?? null,
    }
  }
  if (message.audio) {
    const a = message.audio
    return {
      kind: "audio",
      fileId: a.file_id,
      mimeType: a.mime_type ?? "audio/mpeg",
      fileName: a.file_name ?? `audio-${message.message_id}.mp3`,
      duration: a.duration,
      fileSize: a.file_size ?? null,
    }
  }
  return null
}

// Persist one update into a source_item. Pure persistence — NO secret
// verification, NO ack (callers own those). Scope: direct-message TEXT and
// VOICE/AUDIO; group messages (Phase 3) are ignored. Voice/audio rows store
// the Telegram `file_id` (re-resolved to bytes at parse time) under
// `metadata_json.telegram.media` and are transcribed by `parseTelegramItem`.
// Idempotency rides on `upsertSourceItem`'s UNIQUE(source_id, external_id)
// where external_id = `<chat_id>:<msg_id>`, so a re-delivered / re-pulled
// update updates the row instead of duping.
async function persistTelegramMessage(
  scope: { sourceId: string; organizationId: string | null },
  update: Update,
): Promise<PersistResult> {
  const message = update.message
  if (!message) return { outcome: "ignored" }
  if (message.chat.type !== "private") return { outcome: "ignored" }

  // Drop Telegram service/system messages (joins, leaves, pins, title/photo
  // changes, migrations, auto-delete timer) — no client signal in them.
  if (isServiceMessage(message)) return { outcome: "ignored" }

  const senderName = resolveSenderName(message)
  const telegramMeta = {
    updateId: update.update_id,
    messageId: message.message_id,
    chatId: message.chat.id,
    chatType: message.chat.type,
    date: message.date,
    from: senderMetadata(message),
  }
  const baseUpsert = {
    sourceId: scope.sourceId,
    organizationId: scope.organizationId,
    externalId: `${message.chat.id}:${message.message_id}`,
    externalType: "chat_message" as const,
    threadExternalId: String(message.chat.id),
    sourceCreatedAt: new Date(message.date * 1000),
  }

  // Voice / audio: persist the file reference + any caption. Transcription
  // happens at parse time (`parseTelegramItem` downloads the bytes via the
  // stored `file_id` and runs them through the audio parser).
  const audio = extractTelegramAudio(message)
  if (audio) {
    const caption = message.caption?.trim() ?? ""
    const { id, inserted } = await upsertSourceItem({
      ...baseUpsert,
      metadataJson: {
        provider: "telegram",
        // No usable body text yet — the transcript is produced at parse time.
        // The caption (if any) is kept for context but isn't the parse input.
        rawText: caption,
        text: caption,
        senders: [senderName],
        telegram: { ...telegramMeta, media: audio },
      },
    })
    return {
      outcome: "ingested",
      itemId: id,
      inserted,
      chatId: message.chat.id,
      kind: "voice",
    }
  }

  const text = message.text?.trim()
  if (!text) return { outcome: "ignored" }

  // Drop bot commands (anything starting with "/": /start, /help, /settings, …)
  // — these drive the bot, they aren't messages from a client.
  if (isBotCommand(text)) return { outcome: "ignored" }

  const { id, inserted } = await upsertSourceItem({
    ...baseUpsert,
    metadataJson: {
      provider: "telegram",
      // `rawText` is the body the parser reads (mirrors WhatsApp) — no
      // remote API to re-fetch from, the message text lives in our DB.
      rawText: text,
      text,
      senders: [senderName],
      telegram: telegramMeta,
    },
  })

  return {
    outcome: "ingested",
    itemId: id,
    inserted,
    chatId: message.chat.id,
    kind: "text",
  }
}

// Drive a freshly-ingested telegram item through parse → R2 upload so it
// becomes eligible for card / deal generation within seconds, instead of
// sitting un-parsed until the daily orchestration pipeline (cron 03:00 UTC)
// runs. Telegram arrives in real time via webhook (and on-demand via the
// pull/Fetch button); without this fast-path, an operator clicking the
// dashboard «Magic» button right after a message lands would find nothing
// eligible yet (email "just works" only because it came through an earlier
// scheduled sync that already parsed + uploaded it).
//
// Best-effort: every failure is logged and swallowed. parse + upload are
// idempotent and the orchestration pipeline re-attempts any row that isn't
// `parse_status='complete' AND r2_upload_status='complete'`, so a transient
// failure here just defers the item to the next pipeline run — it never
// blocks the ack or the fetch response.
export async function parseAndUploadTelegramItem(
  itemId: string,
): Promise<void> {
  try {
    const parsed = await parseSourceItem(itemId)
    if (parsed.parentStatus !== "complete") {
      console.warn(
        `[telegram] post-ingest parse not complete for ${itemId}: ` +
          `${parsed.parentParseError ?? parsed.parentStatus}`,
      )
      return
    }
    const uploaded = await uploadSourceItem(itemId)
    if (!uploaded.ok) {
      console.warn(
        `[telegram] post-ingest R2 upload failed for ${itemId}: ` +
          `${uploaded.reason} — ${uploaded.error}`,
      )
    }
  } catch (err) {
    console.error(
      `[telegram] post-ingest parse/upload threw for ${itemId}:`,
      err,
    )
  }
}

// Chat acknowledgement wording. Voice messages take a beat to transcribe, so
// we signal that explicitly rather than implying the text is already readable.
function ackMessage(kind: "text" | "voice", inserted: boolean): string {
  if (!inserted) return "✅ Already received — thanks."
  if (kind === "voice") {
    return "🎙️ Voice message received — transcribing and adding it to your business OS sources."
  }
  return "✅ Received — added to your business OS sources for processing."
}

export type TelegramIngestResult =
  | { ok: true; outcome: "ingested" | "ignored"; itemId?: string; inserted?: boolean }
  | { ok: false; reason: "unauthorized" }

// Webhook delivery path: verify the echoed secret, persist, then ack the
// chat. We still return 200 on ack failure so Telegram doesn't retry.
export async function ingestTelegramUpdate(
  ctx: TelegramWebhookContext,
  update: Update,
  secretHeader: string | null,
): Promise<TelegramIngestResult> {
  if (!verifyTelegramSecret(ctx.webhookSecret, secretHeader)) {
    return { ok: false, reason: "unauthorized" }
  }

  const result = await persistTelegramMessage(
    { sourceId: ctx.sourceId, organizationId: ctx.organizationId },
    update,
  )
  if (result.outcome === "ignored") return { ok: true, outcome: "ignored" }

  try {
    await sendTelegramAck(
      ctx.botToken,
      result.chatId,
      ackMessage(result.kind, result.inserted),
    )
  } catch (err) {
    console.warn(
      `[telegram] ack failed for source ${ctx.sourceId} chat ${result.chatId}:`,
      err,
    )
  }

  return {
    ok: true,
    outcome: "ingested",
    itemId: result.itemId,
    inserted: result.inserted,
  }
}

export type TelegramFetchResult = {
  fetched: number
  ingested: number
  ignored: number
  // True when Telegram refused getUpdates because a webhook is active —
  // in that case messages arrive automatically via the webhook instead.
  webhookActive: boolean
}

// Manual long-poll pull. Drains queued updates via getUpdates and persists
// them, advancing a per-source `telegramOffset` cursor (stored in the
// non-secret provider_config) so each call only sees new messages. This is
// the org-scoped "Fetch" button's backend — primarily for local dev / any
// time no webhook is delivering. Caller (route) is responsible for the
// session + `assertSourceInScope` tenant check before invoking.
const FETCH_DRAIN_PAGES = 10 // ×100 updates = up to 1000 per click
const FETCH_PAGE_LIMIT = 100

export async function fetchTelegramUpdates(
  sourceId: string,
): Promise<TelegramFetchResult> {
  const rows = await db
    .select({
      id: source.id,
      provider: source.provider,
      status: source.status,
      organizationId: source.ownerOrganizationId,
      providerConfig: source.providerConfig,
      credentialsRef: source.credentialsRef,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row || row.provider !== "telegram" || row.status !== "active") {
    throw new Error(`Source ${sourceId} is not an active telegram source`)
  }

  const { botToken } = getTelegramCredentials(sourceId, row.credentialsRef)
  const cfg = (row.providerConfig as Record<string, unknown> | null) ?? {}
  let offset =
    typeof cfg.telegramOffset === "number" ? cfg.telegramOffset : undefined

  const scope = { sourceId, organizationId: row.organizationId }
  let fetched = 0
  let ingested = 0
  let ignored = 0
  // Newly-inserted item ids to drive through parse → R2 upload at the end, so
  // a pulled message is immediately eligible for card / deal generation (same
  // fast-path as the webhook). Re-delivered duplicates aren't collected.
  const newItemIds: string[] = []

  for (let page = 0; page < FETCH_DRAIN_PAGES; page++) {
    let updates
    try {
      updates = await getTelegramUpdates(botToken, {
        offset,
        limit: FETCH_PAGE_LIMIT,
      })
    } catch (err) {
      if (isTelegramWebhookConflict(err)) {
        return { fetched, ingested, ignored, webhookActive: true }
      }
      throw err
    }
    if (updates.length === 0) break

    for (const u of updates) {
      fetched++
      const r = await persistTelegramMessage(scope, u)
      if (r.outcome === "ingested") {
        ingested++
        if (r.inserted) newItemIds.push(r.itemId)
      } else ignored++
      // Next offset = highest seen update_id + 1 (confirms processed ones).
      offset = Math.max(offset ?? 0, u.update_id + 1)
    }
    if (updates.length < FETCH_PAGE_LIMIT) break
  }

  // Persist the advanced cursor so the next click only sees new messages.
  if (offset !== undefined) {
    await db
      .update(source)
      .set({ providerConfig: { ...cfg, telegramOffset: offset } })
      .where(eq(source.id, sourceId))
  }

  // Parse + upload the freshly-pulled messages inline (sequentially) so they're
  // card/deal-eligible by the time this response returns and the operator can
  // act on them immediately. Each call is non-throwing; transient failures fall
  // back to the daily pipeline. Telegram text parses fast, so even a large pull
  // stays comfortably inside the route's maxDuration.
  for (const itemId of newItemIds) {
    await parseAndUploadTelegramItem(itemId)
  }

  return { fetched, ingested, ignored, webhookActive: false }
}

// Register this source's bot webhook with Telegram. Called as a
// side-effect when an org owner / admin saves telegram credentials.
// Skips (returns false) in local dev where there's no public HTTPS origin
// — there Telegram can't reach us, so polling would be used instead.
export async function registerTelegramWebhookForSource(
  sourceId: string,
): Promise<{ registered: boolean; url?: string }> {
  const ctx = await resolveTelegramWebhookContext(sourceId)
  if (!ctx) {
    throw new Error(
      `Cannot register webhook: source ${sourceId} is not an active telegram source`,
    )
  }
  const origin = telegramAppOrigin()
  if (!origin) {
    console.warn(
      `[telegram] no public HTTPS origin (NEXT_PUBLIC_APP_URL) — skipping webhook registration for source ${sourceId}. Use polling in local dev.`,
    )
    return { registered: false }
  }
  const url = telegramWebhookUrl(origin, sourceId)
  await setTelegramWebhook({
    botToken: ctx.botToken,
    url,
    secretToken: ctx.webhookSecret,
  })
  return { registered: true, url }
}
