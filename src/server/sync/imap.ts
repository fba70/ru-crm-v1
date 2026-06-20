import "server-only"

import {
  loadSource,
  stampLastSyncedAt,
  CURSOR_OVERLAP_SECONDS,
  SYNC_PAGE_LIMIT,
  type SyncResult,
} from "./_shared"
import {
  getLatestSourceCreatedAt,
  upsertSourceItem,
} from "@/server/source-items"
import { getImapCredentials } from "@/server/providers/credentials"
import { imapProviderConfigSchema } from "@/server/providers/handlers"
import { buildImapClient } from "@/lib/imap"

// Map an imapflow envelope address to the canonical {name,email} shape that
// discovery's `extractParticipants` reads (the Nylas from/to/cc fallback).
function toParticipants(
  list: Array<{ name?: string; address?: string }> | undefined,
): { name: string; email: string }[] {
  return (list ?? [])
    .filter((a) => a.address)
    .map((a) => ({ name: a.name ?? "", email: (a.address ?? "").toLowerCase() }))
}

/**
 * Incremental, idempotent IMAP sync. Stores only the ENVELOPE (subject +
 * participants), never the body — the full RFC822 is fetched lazily at parse
 * time, keeping sync cheap and the DB small.
 *
 * Identity is `external_id = "<uidValidity>:<uid>"`. IMAP UIDs are only stable
 * within a mailbox generation; `uidValidity` is the generation id. Stamping it
 * into the external_id (and re-checking it at parse time) is what prevents
 * fetching the WRONG message after a server renumber.
 */
export async function syncImapEmails(sourceId: string): Promise<SyncResult> {
  const ctx = await loadSource(sourceId)
  if (ctx.provider !== "imap") {
    throw new Error(
      `Expected imap provider, got ${ctx.provider} for source ${sourceId}`,
    )
  }

  const creds = getImapCredentials(ctx.id, ctx.credentialsRef)
  const { mailbox } = imapProviderConfigSchema.parse(ctx.providerConfig)

  // Cursor: re-scan from 5 min before the newest item we already have so
  // boundary messages re-upsert (dedup by (sourceId, externalId) makes the
  // overlap a no-op). No cursor → full scan.
  const cursor = await getLatestSourceCreatedAt(sourceId)
  const since = cursor
    ? new Date(cursor.getTime() - CURSOR_OVERLAP_SECONDS * 1000)
    : null

  const client = buildImapClient(creds)
  let fetched = 0
  let inserted = 0
  let updated = 0

  await client.connect()
  try {
    const mb = await client.mailboxOpen(mailbox, { readOnly: true })
    // uidValidity is a bigint; serialise to string for the stable external id.
    const uidValidity = mb.uidValidity.toString()

    const uids = await client.search(
      since ? { since } : { all: true },
      { uid: true },
    )
    if (!uids || uids.length === 0) {
      await stampLastSyncedAt(ctx.id)
      return { fetched: 0, inserted: 0, updated: 0 }
    }

    // Keep only the most recent page so a fresh full scan can't pull an
    // unbounded mailbox in one invocation. The cursor advances each run.
    const pageUids = uids.slice(-SYNC_PAGE_LIMIT)

    for await (const msg of client.fetch(
      pageUids,
      { uid: true, envelope: true, internalDate: true },
      { uid: true },
    )) {
      fetched++
      const env = msg.envelope
      const internalDate =
        msg.internalDate instanceof Date
          ? msg.internalDate
          : typeof msg.internalDate === "string"
            ? new Date(msg.internalDate)
            : null
      const sourceCreatedAt = internalDate ?? env?.date ?? null

      const result = await upsertSourceItem({
        sourceId: ctx.id,
        organizationId: ctx.organizationId,
        externalId: `${uidValidity}:${msg.uid}`,
        externalType: "email",
        threadExternalId: env?.inReplyTo ?? null,
        sourceCreatedAt,
        metadataJson: {
          mailbox,
          uid: msg.uid,
          uidValidity,
          messageId: env?.messageId ?? "",
          subject: env?.subject ?? "",
          from: toParticipants(env?.from),
          to: toParticipants(env?.to),
          cc: toParticipants(env?.cc),
        },
      })
      if (result.inserted) inserted++
      else updated++
    }

    await stampLastSyncedAt(ctx.id)
    return { fetched, inserted, updated }
  } finally {
    try {
      await client.logout()
    } catch {
      // best-effort — a failed logout must not mask a successful sync
    }
  }
}
