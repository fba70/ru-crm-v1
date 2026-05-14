"use server"

import { getChatClient } from "@/lib/google-chat"
import {
  upsertSourceItem,
  getLatestSourceCreatedAt,
} from "@/server/source-items"
import { getGchatCredentials } from "@/server/providers/credentials"
import { gchatProviderConfigSchema } from "@/server/providers/handlers"
import {
  CURSOR_OVERLAP_SECONDS,
  SYNC_PAGE_LIMIT,
  loadSource,
  stampLastSyncedAt,
  type SyncResult,
} from "./_shared"

export async function syncGoogleChatMessages(
  sourceId: string,
): Promise<SyncResult> {
  const ctx = await loadSource(sourceId)
  if (ctx.provider !== "gchat") {
    throw new Error(
      `Expected gchat provider, got ${ctx.provider} for source ${sourceId}`,
    )
  }

  const config = gchatProviderConfigSchema.parse(ctx.providerConfig)
  const creds = getGchatCredentials(ctx.id, ctx.credentialsRef)
  const chat = getChatClient(creds)

  const cursor = await getLatestSourceCreatedAt(sourceId)
  // Chat's filter syntax wants RFC3339 with the `T…Z` suffix.
  const cursorIso = cursor
    ? new Date(cursor.getTime() - CURSOR_OVERLAP_SECONDS * 1000).toISOString()
    : null

  const response = await chat.spaces.messages.list({
    parent: config.spaceId,
    pageSize: SYNC_PAGE_LIMIT,
    orderBy: "createTime DESC",
    ...(cursorIso ? { filter: `createTime > "${cursorIso}"` } : {}),
  })

  let inserted = 0
  let updated = 0

  for (const msg of response.data.messages ?? []) {
    if (!msg.name) continue
    const result = await upsertSourceItem({
      sourceId: ctx.id,
      organizationId: ctx.organizationId,
      // Full resource path "spaces/X/messages/Y" — keeps it round-trippable
      // through the Chat SDK (`messages.get({ name })`).
      externalId: msg.name,
      externalType: "chat_message",
      threadExternalId: msg.thread?.name?.split("/").pop() ?? null,
      sourceCreatedAt: msg.createTime ? new Date(msg.createTime) : null,
      metadataJson: {
        author: msg.sender?.displayName ?? "Unknown",
        authorType: msg.sender?.type ?? "HUMAN",
        text: msg.text ?? "",
        attachmentCount: msg.attachment?.length ?? 0,
      },
    })
    if (result.inserted) inserted++
    else updated++
  }

  await stampLastSyncedAt(ctx.id)

  return {
    fetched: response.data.messages?.length ?? 0,
    inserted,
    updated,
  }
}
