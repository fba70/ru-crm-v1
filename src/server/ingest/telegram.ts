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
import type { Update } from "grammy/types"
import { db } from "@/db/drizzle"
import { source } from "@/db/schema"
import { getTelegramCredentials } from "@/server/providers/credentials"
import { upsertSourceItem } from "@/server/source-items"
import {
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

export type TelegramIngestResult =
  | { ok: true; outcome: "ingested" | "ignored"; itemId?: string }
  | { ok: false; reason: "unauthorized" }

// Process one Telegram update. Phase 1 scope: direct-message TEXT only —
// group messages (Phase 3) and attachments (Phase 2) are ignored for now.
// Idempotency rides on `upsertSourceItem`'s UNIQUE(source_id, external_id)
// where external_id = `<chat_id>:<message_id>`, so a retried delivery
// updates the existing row instead of inserting a duplicate.
export async function ingestTelegramUpdate(
  ctx: TelegramWebhookContext,
  update: Update,
  secretHeader: string | null,
): Promise<TelegramIngestResult> {
  if (!verifyTelegramSecret(ctx.webhookSecret, secretHeader)) {
    return { ok: false, reason: "unauthorized" }
  }

  const message = update.message
  if (!message) return { ok: true, outcome: "ignored" }

  // Phase 1: private chats only. Group @-mentions land in Phase 3.
  if (message.chat.type !== "private") {
    return { ok: true, outcome: "ignored" }
  }

  // Phase 1: text only. Attachments (photo/document/voice/…) land in
  // Phase 2 via getFile + download → child source_items.
  const text = message.text?.trim()
  if (!text) return { ok: true, outcome: "ignored" }

  const from = message.from
  const senderName =
    [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim() ||
    from?.username ||
    "Telegram user"

  const externalId = `${message.chat.id}:${message.message_id}`
  const sourceCreatedAt = new Date(message.date * 1000)

  const { id, inserted } = await upsertSourceItem({
    sourceId: ctx.sourceId,
    organizationId: ctx.organizationId,
    externalId,
    externalType: "chat_message",
    threadExternalId: String(message.chat.id),
    sourceCreatedAt,
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

  // Best-effort ack — never let a send failure fail ingestion (the item is
  // already persisted) or trigger a Telegram retry (we still return 200).
  try {
    await sendTelegramAck(
      ctx.botToken,
      message.chat.id,
      inserted
        ? "✅ Received — added to your Truffalo sources for processing."
        : "✅ Already received — thanks.",
    )
  } catch (err) {
    console.warn(
      `[telegram] ack failed for source ${ctx.sourceId} chat ${message.chat.id}:`,
      err,
    )
  }

  return { ok: true, outcome: "ingested", itemId: id }
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
