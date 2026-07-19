import "server-only"

import { Bot, GrammyError } from "grammy"
import type { Update } from "grammy/types"

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

// Long-poll pull. The manual-fetch counterpart to the webhook push — used
// to ingest on demand when no webhook is delivering (local dev, or before
// a public URL is configured). `timeout: 0` = return immediately with
// whatever is queued (no long-poll wait). Passing `offset` confirms (and
// drops) every update below it server-side, so the next call only returns
// new ones. NOTE: Telegram refuses getUpdates while a webhook is active
// (409) — detect with `isTelegramWebhookConflict`.
export async function getTelegramUpdates(
  botToken: string,
  opts: { offset?: number; limit?: number },
): Promise<Update[]> {
  return botApi(botToken).getUpdates({
    offset: opts.offset,
    limit: opts.limit ?? 100,
    timeout: 0,
    allowed_updates: [...ALLOWED_UPDATES],
  })
}

// True when a getUpdates call failed because a webhook is registered for
// the bot — the manual pull and the webhook push are mutually exclusive.
export function isTelegramWebhookConflict(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 409
}

// Download a Telegram file (voice/audio attachment) by its stable `file_id`.
// Two hops per the Bot API: `getFile` resolves the id to a temporary
// `file_path`, then the bytes are fetched from the file CDN with the bot
// token in the URL. The `file_path` link is short-lived (~1h) but `file_id`
// is stable and re-resolvable, so this is safe to call at parse time (even on
// a re-parse) rather than persisting the bytes at ingest. Voice notes are a
// few hundred KB, so buffering the whole body is fine.
export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
): Promise<{ bytes: Buffer; filePath: string }> {
  const file = await botApi(botToken).getFile(fileId)
  const filePath = file.file_path
  if (!filePath) {
    throw new Error(`Telegram getFile returned no file_path for ${fileId}`)
  }
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `Telegram file download failed (${res.status} ${res.statusText}) for ${fileId}`,
    )
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, filePath }
}
