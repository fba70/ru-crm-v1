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
  type SyncResult,
} from "./_shared"

// Pulls inbox messages from Nylas since the last fetched item's date,
// upserts each into source_item. Attachments are NOT created here —
// they're discovered at parse time and persisted as child source_items
// by the parse pipeline (parent_source_item_id → this row).
export async function syncNylasEmails(sourceId: string): Promise<SyncResult> {
  const ctx = await loadSource(sourceId)
  if (ctx.provider !== "nylas") {
    throw new Error(
      `Expected nylas provider, got ${ctx.provider} for source ${sourceId}`,
    )
  }

  const { grantId } = getNylasCredentials(ctx.id, ctx.credentialsRef)

  const cursor = await getLatestSourceCreatedAt(sourceId)
  const receivedAfter = cursor
    ? Math.floor(cursor.getTime() / 1000) - CURSOR_OVERLAP_SECONDS
    : undefined

  const response = await nylas.messages.list({
    identifier: grantId,
    queryParams: {
      limit: SYNC_PAGE_LIMIT,
      in: ["INBOX"],
      ...(receivedAfter !== undefined ? { receivedAfter } : {}),
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
