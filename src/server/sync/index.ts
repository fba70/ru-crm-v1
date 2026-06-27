"use server"

import { loadSource, type SyncResult, type SyncOptions } from "./_shared"
import { getHandler } from "@/server/providers/handlers"

// Dispatches by provider via the registry in `src/server/providers/handlers.ts`.
// Providers without a remote API (dropoff / whatsapp / aichat) are
// represented by a null `sync` handler — calling syncSource for those
// throws with a clear message instead of silently no-op'ing. Their
// items arrive via dedicated upload routes
// (`/api/sources/{dropoff,whatsapp}/upload`) or are written directly at
// save time (aichat via `save-chat-session`).
export async function syncSource(
  sourceId: string,
  opts?: SyncOptions,
): Promise<SyncResult> {
  const ctx = await loadSource(sourceId)
  const handler = getHandler(ctx.provider)
  if (!handler.sync) {
    throw new Error(
      `Provider '${ctx.provider}' does not support remote sync — items arrive via upload or save-time write`,
    )
  }
  return handler.sync(sourceId, opts)
}
