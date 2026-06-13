import { NextRequest, NextResponse } from "next/server"
import type { Update } from "grammy/types"
import {
  resolveTelegramWebhookContext,
  ingestTelegramUpdate,
} from "@/server/ingest/telegram"
import {
  MissingCredentialsError,
  InvalidCredentialsError,
} from "@/server/providers/credentials"

// Public, org-UNSCOPED webhook endpoint — Telegram is the caller, there is
// no session. Authorization is the opaque `sourceId` path segment (resolves
// source → org) PLUS the per-source secret echoed in the
// `X-Telegram-Bot-Api-Secret-Token` header (verified in ingest). Sits under
// /api/webhooks (outside the (protected) tree) so no auth gate applies.
//
// Node runtime (file download + parsing in later phases need Node APIs);
// force-dynamic so the route is never statically optimized. Fast-ack: do
// the minimum synchronously (verify → resolve → upsert → ack) and return
// 200. Telegram retries on non-200, and `upsertSourceItem`'s unique key
// makes retries idempotent.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await params

  let update: Update
  try {
    update = (await request.json()) as Update
  } catch {
    // Malformed body — ack so Telegram doesn't hammer retries on garbage.
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  let ctx
  try {
    ctx = await resolveTelegramWebhookContext(sourceId)
  } catch (err) {
    // Source exists but isn't configured yet (owner hasn't saved creds) —
    // 503 so Telegram retries later once it's set up, rather than dropping.
    if (
      err instanceof MissingCredentialsError ||
      err instanceof InvalidCredentialsError
    ) {
      return NextResponse.json(
        { error: "Telegram source not configured" },
        { status: 503 },
      )
    }
    console.error(`[telegram webhook] resolve failed for ${sourceId}:`, err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }

  // Unknown / non-telegram / inactive source. 404 — don't reveal which.
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const secretHeader = request.headers.get(
    "x-telegram-bot-api-secret-token",
  )

  try {
    const result = await ingestTelegramUpdate(ctx, update, secretHeader)
    if (!result.ok) {
      // Secret mismatch — reject the forgery.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    console.error(`[telegram webhook] ingest failed for ${sourceId}:`, err)
    // 500 → Telegram retries; the unique key keeps the retry idempotent.
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
