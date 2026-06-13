import "server-only"

import { Bot } from "grammy"

// Thin grammY wrapper for the per-org Telegram bot model. Every helper
// takes the bot token explicitly (decrypted from `source.credentials_ref`)
// rather than reading a global env — each org runs its own bot, so there's
// no single ambient token. We only use grammY's `Api` surface here (no
// handler dispatch / `bot.start()`); the webhook route parses updates
// itself and calls `sendTelegramAck` to reply.
//
// Constructing `new Bot(token)` does NOT make a network call — `bot.api.*`
// is usable immediately without `bot.init()` (init only fetches `getMe`,
// which we don't need for Phase 1 DM ingestion).

// Phase 1 only consumes `message` updates (DM text). Phase 2/3 widen this
// to `edited_message` / `callback_query` for attachments + group actions.
const ALLOWED_UPDATES = ["message"] as const

function botApi(botToken: string) {
  return new Bot(botToken).api
}

// The public origin Telegram should POST updates to. Must be HTTPS and
// publicly reachable — Telegram refuses http/localhost. In local dev there
// is no public URL, so webhook registration is skipped (see
// `registerTelegramWebhookForSource`) and polling would be used instead.
export function telegramAppOrigin(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? null
  if (!raw) return null
  const trimmed = raw.replace(/\/+$/, "")
  if (!/^https:\/\//i.test(trimmed)) return null
  return trimmed
}

// Per-source webhook path — the opaque `sourceId` in the path is the
// routing key that resolves source → org. Telegram only ever knows this
// URL (set via setWebhook) and echoes the per-source secret in a header,
// so even if the URL leaks an attacker still can't forge deliveries.
export function telegramWebhookUrl(origin: string, sourceId: string): string {
  return `${origin}/api/webhooks/telegram/${sourceId}`
}

// Register (or re-register) the bot's webhook to point at this source's
// path with its per-source secret. Idempotent — Telegram replaces any
// existing webhook for the bot. Returns the URL that was set.
export async function setTelegramWebhook(args: {
  botToken: string
  url: string
  secretToken: string
}): Promise<void> {
  await botApi(args.botToken).setWebhook(args.url, {
    secret_token: args.secretToken,
    allowed_updates: [...ALLOWED_UPDATES],
    // Drop any updates that piled up while the webhook was down / before
    // the source was configured — we only want messages from now on.
    drop_pending_updates: true,
  })
}

export async function deleteTelegramWebhook(botToken: string): Promise<void> {
  await botApi(botToken).deleteWebhook({ drop_pending_updates: false })
}

// Best-effort acknowledgement back to the chat. Failures here must never
// fail ingestion — the webhook already persisted the item.
export async function sendTelegramAck(
  botToken: string,
  chatId: number | string,
  text: string,
): Promise<void> {
  await botApi(botToken).sendMessage(chatId, text)
}
