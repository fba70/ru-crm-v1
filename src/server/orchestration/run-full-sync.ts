import "server-only"

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, type SourceProvider } from "@/db/schema"
import { syncSource } from "@/server/sync"
import { syncableProviders } from "@/lib/sources/providers"

export type PerSourceSyncOutcome =
  | {
      ok: true
      sourceId: string
      sourceName: string
      provider: SourceProvider
      fetched: number
      inserted: number
      updated: number
    }
  | {
      ok: false
      sourceId: string
      sourceName: string
      provider: SourceProvider
      error: string
    }

export type FullSyncResult = {
  perSource: PerSourceSyncOutcome[]
  // Aggregates pre-computed for the pipeline_run row.
  totalsourcesAttempted: number
  totalSourcesSucceeded: number
  totalSourcesFailed: number
  totalItemsInserted: number
  totalItemsUpdated: number
}

// Iterate every active syncable source and call `syncSource`. Each per-
// source call is wrapped in its own try/catch so a Nylas outage doesn't
// block Drive sync (or vice versa). Providers without a remote API
// (dropoff / whatsapp / aichat) are excluded — files / saves arrive via
// direct upload routes or save-time writes, not provider fetch.
//
// The provider filter comes from the registry (`syncableProviders()`),
// so adding a new provider only requires updating
// `src/lib/sources/providers.ts` — this loop picks it up automatically.
//
// `automatedParsingIsAllowed = false` filters the source out entirely:
// no fetch, and (paired with the joins in parse-pending / upload-pending)
// no parse / upload of any items already in the queue under that source.
// Manual UI actions remain available — the flag only gates the cron.
export async function runFullSync(): Promise<FullSyncResult> {
  const sources = await db
    .select({
      id: source.id,
      name: source.name,
      provider: source.provider,
    })
    .from(source)
    .where(
      and(
        eq(source.status, "active"),
        eq(source.automatedParsingIsAllowed, true),
        inArray(source.provider, syncableProviders()),
      ),
    )

  const perSource: PerSourceSyncOutcome[] = []
  let totalSourcesSucceeded = 0
  let totalSourcesFailed = 0
  let totalItemsInserted = 0
  let totalItemsUpdated = 0

  for (const s of sources) {
    try {
      const r = await syncSource(s.id)
      perSource.push({
        ok: true,
        sourceId: s.id,
        sourceName: s.name,
        provider: s.provider,
        fetched: r.fetched,
        inserted: r.inserted,
        updated: r.updated,
      })
      totalSourcesSucceeded++
      totalItemsInserted += r.inserted
      totalItemsUpdated += r.updated
    } catch (err) {
      perSource.push({
        ok: false,
        sourceId: s.id,
        sourceName: s.name,
        provider: s.provider,
        error: err instanceof Error ? err.message : String(err),
      })
      totalSourcesFailed++
    }
  }

  return {
    perSource,
    totalsourcesAttempted: sources.length,
    totalSourcesSucceeded,
    totalSourcesFailed,
    totalItemsInserted,
    totalItemsUpdated,
  }
}
