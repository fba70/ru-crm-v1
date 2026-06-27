"use server"

import nylas from "@/lib/nylas"
import {
  upsertSourceItem,
  getLatestSourceCreatedAt,
} from "@/server/source-items"
import { getNylasCredentials } from "@/server/providers/credentials"
import {
  CURSOR_OVERLAP_SECONDS,
  SYNC_PAGE_LIMIT,
  loadSource,
  stampLastSyncedAt,
  windowBoundSeconds,
  type SyncResult,
  type SyncOptions,
} from "./_shared"

// Pulls inbox messages from Nylas, upserts each into source_item.
// Two modes:
//   • Incremental (default): from the newest item we already have − overlap.
//   • Windowed backfill (`opts.sinceIso` set): a bounded [since, until] range,
//     IGNORING the incremental cursor — the only way to re-pull historical mail
//     that's already behind the high-water mark (e.g. a hard-deleted test row).
// Attachments are NOT created here — they're discovered at parse time and
// persisted as child source_items by the parse pipeline.
export async function syncNylasEmails(
  sourceId: string,
  opts?: SyncOptions,
): Promise<SyncResult> {
  const ctx = await loadSource(sourceId)
  if (ctx.provider !== "nylas") {
    throw new Error(
      `Expected nylas provider, got ${ctx.provider} for source ${sourceId}`,
    )
  }

  const { grantId } = getNylasCredentials(ctx.id, ctx.credentialsRef)

  // The window's `since` only ever EXTENDS the fetch earlier (lower of the two
  // bounds), never narrows it — so the default (period = today) degenerates to
  // the normal incremental catch-up and can't silently drop late mail from
  // prior days, while a PAST from-date re-pulls that historical window (the
  // backfill that recovers rows behind the high-water mark). `until` caps the
  // top so a small recovery window isn't truncated by the per-call page limit.
  const windowSince = windowBoundSeconds(opts?.sinceIso)
  const windowUntil = windowBoundSeconds(opts?.untilIso, { endOfDay: true })

  const cursor = await getLatestSourceCreatedAt(sourceId)
  const cursorFloor = cursor
    ? Math.floor(cursor.getTime() / 1000) - CURSOR_OVERLAP_SECONDS
    : null

  let receivedAfter: number | undefined
  if (windowSince !== null && cursorFloor !== null) {
    receivedAfter = Math.min(cursorFloor, windowSince)
  } else {
    receivedAfter = windowSince ?? cursorFloor ?? undefined
  }
  const receivedBefore = windowUntil ?? undefined

  const response = await nylas.messages.list({
    identifier: grantId,
    queryParams: {
      limit: SYNC_PAGE_LIMIT,
      in: ["INBOX"],
      ...(receivedAfter !== undefined ? { receivedAfter } : {}),
      ...(receivedBefore !== undefined ? { receivedBefore } : {}),
    },
  })

  let inserted = 0
  let updated = 0

  for (const msg of response.data ?? []) {
    if (!msg.id) continue
    const result = await upsertSourceItem({
      sourceId: ctx.id,
      organizationId: ctx.organizationId,
      externalId: msg.id,
      externalType: "email",
      threadExternalId: msg.threadId ?? null,
      sourceCreatedAt:
        typeof msg.date === "number" ? new Date(msg.date * 1000) : null,
      metadataJson: {
        subject: msg.subject ?? "",
        snippet: msg.snippet ?? "",
        from: msg.from ?? [],
        to: msg.to ?? [],
        cc: msg.cc ?? [],
        bcc: msg.bcc ?? [],
        attachmentCount: msg.attachments?.length ?? 0,
      },
    })
    if (result.inserted) inserted++
    else updated++
  }

  await stampLastSyncedAt(ctx.id)

  return {
    fetched: response.data?.length ?? 0,
    inserted,
    updated,
  }
}
