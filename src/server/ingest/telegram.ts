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
  | { outcome: "ingested"; itemId: string; inserted: boolean; chatId: number }
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

// Persist one update into a source_item. Pure persistence — NO secret
// verification, NO ack (callers own those). Phase 1 scope: direct-message
// TEXT only; group messages (Phase 3) and attachments (Phase 2) are
// ignored. Idempotency rides on `upsertSourceItem`'s
// UNIQUE(source_id, external_id) where external_id = `<chat_id>:<msg_id>`,
// so a re-delivered / re-pulled update updates the row instead of duping.
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

  const text = message.text?.trim()
  if (!text) return { outcome: "ignored" }

  // Drop bot commands (anything starting with "/": /start, /help, /settings, …)
  // — these drive the bot, they aren't messages from a client.
  if (isBotCommand(text)) return { outcome: "ignored" }

  const from = message.from
  const senderName =
    [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim() ||
    from?.username ||
    "Telegram user"

  const { id, inserted } = await upsertSourceItem({
    sourceId: scope.sourceId,
    organizationId: scope.organizationId,
    externalId: `${message.chat.id}:${message.message_id}`,
    externalType: "chat_message",
    threadExternalId: String(message.chat.id),
    sourceCreatedAt: new Date(message.date * 1000),
    metadataJson: {
      provider: "telegram",
      // `rawText` is the body the parser reads (mirrors WhatsApp) — no
      // remote API to re-fetch from, the message text lives in our DB.
      rawText: text,
      text,
      senders: [senderName],
      telegram: {
        updateId: update.update_id,
        messageId: message.message_id,
        chatId: message.chat.id,
        chatType: message.chat.type,
        date: message.date,
        from: from
          ? {
              id: from.id,
              isBot: from.is_bot,
              username: from.username ?? null,
              firstName: from.first_name ?? null,
              lastName: from.last_name ?? null,
            }
          : null,
      },
    },
  })

  return { outcome: "ingested", itemId: id, inserted, chatId: message.chat.id }
}

export type TelegramIngestResult =
  | { ok: true; outcome: "ingested" | "ignored"; itemId?: string }
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
      result.inserted
        ? "✅ Received — added to your Truffalo sources for processing."
        : "✅ Already received — thanks.",
    )
  } catch (err) {
    console.warn(
      `[telegram] ack failed for source ${ctx.sourceId} chat ${result.chatId}:`,
      err,
    )
  }

  return { ok: true, outcome: "ingested", itemId: result.itemId }
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
      if (r.outcome === "ingested") ingested++
      else ignored++
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
