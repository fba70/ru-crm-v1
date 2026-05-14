"use server"

import { getDriveClient } from "@/lib/google-drive"
import {
  upsertSourceItem,
  getLatestSourceCreatedAt,
} from "@/server/source-items"
import { getGdriveCredentials } from "@/server/providers/credentials"
import { gdriveProviderConfigSchema } from "@/server/providers/handlers"
import {
  CURSOR_OVERLAP_SECONDS,
  SYNC_PAGE_LIMIT,
  loadSource,
  stampLastSyncedAt,
  type SyncResult,
} from "./_shared"

const FOLDER_MIME = "application/vnd.google-apps.folder"

// Pulls files from a shared Drive that have been modified since the
// last sync. We use modifiedTime as the cursor (and as sourceCreatedAt
// per the schema comment), which means an edited file naturally
// resurfaces and gets its metadata refreshed. Detecting "modifiedTime
// advanced → reset parseStatus to 'pending'" is intentionally NOT
// done here — admins can manually re-parse from the UI for now.
// Folders are skipped (not parseable). Trashed files surface only if
// their modifiedTime is recent; the q-clause here doesn't filter them.
export async function syncGoogleDriveFiles(
  sourceId: string,
): Promise<SyncResult> {
  const ctx = await loadSource(sourceId)
  if (ctx.provider !== "gdrive") {
    throw new Error(
      `Expected gdrive provider, got ${ctx.provider} for source ${sourceId}`,
    )
  }

  const config = gdriveProviderConfigSchema.parse(ctx.providerConfig)
  const creds = getGdriveCredentials(ctx.id, ctx.credentialsRef)
  const drive = getDriveClient(creds)

  const cursor = await getLatestSourceCreatedAt(sourceId)
  const cursorIso = cursor
    ? new Date(cursor.getTime() - CURSOR_OVERLAP_SECONDS * 1000).toISOString()
    : null

  const queryParts: string[] = [`mimeType != '${FOLDER_MIME}'`]
  if (cursorIso) {
    queryParts.push(`modifiedTime > '${cursorIso}'`)
  }

  const response = await drive.files.list({
    driveId: config.driveId,
    corpora: "drive",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: SYNC_PAGE_LIMIT,
    orderBy: "modifiedTime desc",
    fields:
      "files(id,name,mimeType,createdTime,modifiedTime,size,webViewLink,owners)",
    q: queryParts.join(" and "),
  })

  let inserted = 0
  let updated = 0

  for (const file of response.data.files ?? []) {
    if (!file.id) continue
    const sizeBytes =
      typeof file.size === "string" ? Number.parseInt(file.size, 10) : null
    const result = await upsertSourceItem({
      sourceId: ctx.id,
      organizationId: ctx.organizationId,
      externalId: file.id,
      externalType: "drive_file",
      externalUrl: file.webViewLink ?? null,
      filename: file.name ?? null,
      mimeType: file.mimeType ?? null,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
      sourceCreatedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
      metadataJson: {
        createdTime: file.createdTime ?? null,
        modifiedTime: file.modifiedTime ?? null,
        owners: (file.owners ?? []).map(
          (o) => o.displayName ?? o.emailAddress ?? "Unknown",
        ),
      },
    })
    if (result.inserted) inserted++
    else updated++
  }

  await stampLastSyncedAt(ctx.id)

  return {
    fetched: response.data.files?.length ?? 0,
    inserted,
    updated,
  }
}
