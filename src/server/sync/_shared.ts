// Not "use server" — that directive only allows async-function exports,
// and this module also exports plain constants and types. It's still
// server-only (only consumed by other server modules and API routes);
// `server-only` makes that contract explicit and trips a build error
// if it ever gets pulled into a client bundle.
import "server-only"

import { db } from "@/db/drizzle"
import { source } from "@/db/schema"
import { eq } from "drizzle-orm"
import type { SourceProvider } from "@/db/schema"

// Overlap window applied to the cursor on every sync — absorbs provider
// clock skew and items that were created right at the boundary of the
// previous sync. The unique-index dedup on (sourceId, externalId) makes
// the overlap a no-op for items we already have.
export const CURSOR_OVERLAP_SECONDS = 5 * 60

// Hard cap per call so a fresh sync can't pull millions of rows in one
// invocation. If a source falls behind by more than this the user (or
// cron) just runs sync again — the cursor advances each time.
export const SYNC_PAGE_LIMIT = 100

export type SourceContext = {
  id: string
  provider: SourceProvider
  organizationId: string | null
  providerConfig: Record<string, unknown>
  // AES-256-GCM ciphertext (base64) of the per-source credential
  // payload. Decrypted + zod-validated via the per-provider helpers in
  // `src/server/providers/credentials.ts`. Null for providers that
  // don't need credentials (dropoff/whatsapp/aichat) and on rows that
  // pre-date the credentials migration (in which case the accessor
  // falls back to env where policy permits).
  credentialsRef: string | null
}

export async function loadSource(sourceId: string): Promise<SourceContext> {
  const rows = await db
    .select({
      id: source.id,
      provider: source.provider,
      organizationId: source.ownerOrganizationId,
      providerConfig: source.providerConfig,
      credentialsRef: source.credentialsRef,
      status: source.status,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)

  const row = rows[0]
  if (!row) throw new Error(`Source not found: ${sourceId}`)
  if (row.status !== "active") {
    throw new Error(`Source is not active: ${sourceId}`)
  }

  return {
    id: row.id,
    provider: row.provider,
    organizationId: row.organizationId,
    providerConfig: (row.providerConfig as Record<string, unknown> | null) ?? {},
    credentialsRef: row.credentialsRef,
  }
}

export async function stampLastSyncedAt(sourceId: string): Promise<void> {
  await db
    .update(source)
    .set({ lastSyncedAt: new Date() })
    .where(eq(source.id, sourceId))
}

export type SyncResult = {
  fetched: number
  inserted: number
  updated: number
}

// Optional explicit fetch window for a sync. When unset, sync is incremental
// (newest item we already have − overlap → now). When `sinceIso` is set, the
// provider is asked for a BOUNDED window instead — this is the only way to
// re-pull historical mail that's already behind the incremental cursor (e.g.
// an item whose source_item row was hard-deleted for a test: deleting one row
// in the middle of the timeline doesn't lower the high-water mark, so plain
// re-sync never re-requests it). Dates may be `YYYY-MM-DD` (interpreted as the
// whole UTC day) or full ISO timestamps. `untilIso` upper-bounds the window so
// a small range can't be truncated by the per-call page cap.
export type SyncOptions = {
  sinceIso?: string
  untilIso?: string
}

// Parse a window bound. Returns unix SECONDS, or null for empty/invalid input.
// `endOfDay` rolls a date-only string to the start of the NEXT day so the
// named day is fully included as an exclusive upper bound.
export function windowBoundSeconds(
  value: string | undefined,
  opts?: { endOfDay?: boolean },
): number | null {
  if (!value || !value.trim()) return null
  const ms = Date.parse(value.trim())
  if (Number.isNaN(ms)) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
  const adjusted =
    opts?.endOfDay && dateOnly ? ms + 24 * 60 * 60 * 1000 : ms
  return Math.floor(adjusted / 1000)
}
