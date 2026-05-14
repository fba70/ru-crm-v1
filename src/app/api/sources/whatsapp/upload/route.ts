import { NextRequest, NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, sourceItem } from "@/db/schema"
import { getServerSession } from "@/lib/get-session"
import {
  parseChatTxt,
  renderGroupTranscript,
  type WhatsAppGroup,
} from "@/server/parsers/whatsapp"
import {
  parseDropoffFile,
  UnsupportedDropoffTypeError,
  PdfTooLargeError,
  ImageTooLargeError,
  UnsupportedImageTypeError,
  AudioTooLargeError,
  UnsupportedAudioTypeError,
  VideoTooLargeError,
  UnsupportedVideoTypeError,
  OfficeTooLargeError,
  UnsupportedOfficeTypeError,
} from "@/server/parsers/dropoff"

const PARSER_MODEL = "google/gemini-2.5-flash"

// WhatsApp video parsing dominates wall-clock — match the per-item
// Parse route's ceiling so a 50 MB MP4 still fits comfortably.
export const maxDuration = 300

// ── Result shapes ─────────────────────────────────────────────────────

type GroupResult = {
  kind: "group"
  groupKey: string
  itemId: string
  ok: true
  inserted: boolean
  startTimestamp: string
  endTimestamp: string
  authors: string[]
  attachmentRefs: number
}

type AttachmentSuccess = {
  kind: "attachment"
  fileName: string
  itemId: string
  ok: true
  inserted: boolean
  // Row id of the chat group this attachment is linked to, or null if
  // it didn't match any `<attached: …>` reference (standalone media).
  parentItemId: string | null
}

type FileFailure = {
  kind: "attachment"
  fileName: string
  ok: false
  reason: "unsupported" | "too_large" | "failed"
  error: string
}

type Result = GroupResult | AttachmentSuccess | FileFailure

// Multipart form layout (mirrors what the dialog sends):
//   files[]  — every File object from the picked folder
//   paths[]  — webkitRelativePath for each file, in the same order so
//              the server can pair them up. We use names to identify
//              `_chat.txt` and to match attachment markers, but the
//              full relative path is logged for diagnostics.
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
  }

  const files = formData.getAll("files").filter((v): v is File => v instanceof File)
  const paths = formData.getAll("paths").map((v) => (typeof v === "string" ? v : ""))
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 })
  }

  // Locate the WhatsApp Archive source for this org. Per spec there's
  // exactly one per org (seeded via scripts/seed-whatsapp-source.ts).
  const sourceRows = await db
    .select({
      id: source.id,
      organizationId: source.ownerOrganizationId,
    })
    .from(source)
    .where(
      and(
        eq(source.provider, "whatsapp"),
        eq(source.ownerOrganizationId, activeOrgId),
        eq(source.status, "active"),
      ),
    )
    .limit(1)
  const wa = sourceRows[0]
  if (!wa) {
    return NextResponse.json(
      { error: "No WhatsApp Archive source configured for this organization" },
      { status: 404 },
    )
  }

  // ── Pass 1: pull the chat history file out of the upload (case-insensitive)
  const chatFileIndex = files.findIndex((f, i) => {
    const name = (paths[i] || f.name).split("/").pop() || f.name
    return name.toLowerCase() === "_chat.txt"
  })
  const chatFile = chatFileIndex >= 0 ? files[chatFileIndex] : null

  // ── Pass 2: parse `_chat.txt` if present, build the group rows
  let groups: WhatsAppGroup[] = []
  let chatFormat: "ios" | "android" | "unknown" = "unknown"
  if (chatFile) {
    const text = await chatFile.text()
    const parsed = parseChatTxt(text)
    groups = parsed.groups
    chatFormat = parsed.format
  }

  // Map filename → claiming chat-group source_item.id. Built from BOTH
  // groups parsed in the current request AND chat groups already in the
  // DB for this source — the latter is what makes chunked uploads work:
  // chunk 0 carries `_chat.txt` and inserts groups; chunks 1+ carry
  // only media files but still need to find their parent group rows.
  const claimedBy: Map<string, string> = new Map()
  const existingGroupRows = await db
    .select({
      id: sourceItem.id,
      metadataJson: sourceItem.metadataJson,
    })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.sourceId, wa.id),
        eq(sourceItem.externalType, "chat_message"),
      ),
    )
  for (const row of existingGroupRows) {
    const meta = row.metadataJson as { attachmentFilenames?: unknown }
    const filenames = Array.isArray(meta.attachmentFilenames)
      ? meta.attachmentFilenames.filter((v): v is string => typeof v === "string")
      : []
    for (const filename of filenames) {
      // First reference wins — same filename in two groups is rare, and
      // we don't want a later partial-archive re-import to silently
      // change an attachment's parent linkage.
      if (!claimedBy.has(filename)) claimedBy.set(filename, row.id)
    }
  }

  const groupResults: GroupResult[] = []

  const now = new Date()

  for (const group of groups) {
    const transcript = renderGroupTranscript(group)
    const externalId = `whatsapp:group:${group.groupKey}`

    // Dedup: same archive re-uploaded → existing row stays as-is.
    const existing = await db
      .select({ id: sourceItem.id })
      .from(sourceItem)
      .where(
        and(
          eq(sourceItem.sourceId, wa.id),
          eq(sourceItem.externalId, externalId),
        ),
      )
      .limit(1)

    let rowId: string
    let inserted: boolean
    if (existing.length > 0) {
      rowId = existing[0].id
      inserted = false
    } else {
      rowId = randomUUID()
      inserted = true
      await db.insert(sourceItem).values({
        id: rowId,
        sourceId: wa.id,
        organizationId: wa.organizationId,
        externalId,
        externalType: "chat_message",
        metadataJson: {
          provider: "whatsapp",
          format: chatFormat,
          groupKey: group.groupKey,
          startTimestamp: group.startTimestamp.toISOString(),
          endTimestamp: group.endTimestamp.toISOString(),
          authors: group.authors,
          messageCount: group.messages.length,
          attachmentFilenames: group.attachmentFilenames,
          // Persisted transcript — what the Parse step's LLM call reads.
          // Storing it on the row is necessary because WhatsApp has no
          // remote API to re-fetch from at parse time.
          rawText: transcript,
        },
        // Attachment markers are tracked separately; keep filename null
        // so the Stored Content "Filename" column doesn't conflate the
        // group transcript with a file.
        filename: null,
        mimeType: null,
        sizeBytes: transcript.length,
        sourceCreatedAt: group.startTimestamp,
        fetchedAt: now,
        parseStatus: "pending",
      })
    }
    // Populate filename → row-id mappings for attachments arriving in
    // this same request. (The DB-pre-fill at the top of the function
    // handles parents from previous chunks.)
    for (const filename of group.attachmentFilenames) {
      if (!claimedBy.has(filename)) claimedBy.set(filename, rowId)
    }
    groupResults.push({
      kind: "group",
      groupKey: group.groupKey,
      itemId: rowId,
      ok: true,
      inserted,
      startTimestamp: group.startTimestamp.toISOString(),
      endTimestamp: group.endTimestamp.toISOString(),
      authors: group.authors,
      attachmentRefs: group.attachmentFilenames.length,
    })
  }

  // ── Pass 3: parse + insert non-chat-history files inline.
  const userName = session.user?.name ?? "Unknown user"
  const attachmentResults: Result[] = []

  for (let i = 0; i < files.length; i++) {
    if (i === chatFileIndex) continue
    const file = files[i]
    const fileName = file.name || "untitled"

    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await file.arrayBuffer())
    } catch (err) {
      attachmentResults.push({
        kind: "attachment",
        fileName,
        ok: false,
        reason: "failed",
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    // Stable id: content-hash so re-uploading the same archive de-dups
    // even if the file's webkitRelativePath shifts.
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16)
    const externalId = `whatsapp-att:${hash}`
    // claimedBy now maps filename → chat-group row id directly, merged
    // from existing DB groups + groups inserted in this request. Parent
    // linkage works across chunked uploads.
    const parentRowId = claimedBy.get(fileName) ?? null

    // Dedup before parsing — saves the LLM call on a redundant re-upload.
    const existing = await db
      .select({ id: sourceItem.id })
      .from(sourceItem)
      .where(
        and(
          eq(sourceItem.sourceId, wa.id),
          eq(sourceItem.externalId, externalId),
        ),
      )
      .limit(1)
    if (existing.length > 0) {
      attachmentResults.push({
        kind: "attachment",
        fileName,
        itemId: existing[0].id,
        ok: true,
        inserted: false,
        parentItemId: parentRowId,
      })
      continue
    }

    try {
      const parsed = await parseDropoffFile({
        bytes,
        fileName,
        mediaType: file.type || "application/octet-stream",
        // dropoffId is just an identifier inside the dropoff parser's
        // markdown frontmatter; reuse the content hash so it's stable.
        dropoffId: hash,
        description: "",
        userName,
        uploadedAt: now.toISOString(),
      })

      const rootId = randomUUID()
      const firstBlock = parsed.blocks[0]
      await db.insert(sourceItem).values({
        id: rootId,
        sourceId: wa.id,
        organizationId: wa.organizationId,
        externalId,
        externalType: "attachment",
        parentSourceItemId: parentRowId,
        metadataJson: {
          provider: "whatsapp",
          contentHash: hash,
          parentItemId: parentRowId,
          relativePath: paths[i] || null,
          ...firstBlock.analysis,
        },
        filename: fileName,
        mimeType: parsed.mediaType,
        sizeBytes: parsed.byteSize,
        sourceCreatedAt: now,
        fetchedAt: now,
        parseStatus: "complete",
        parsedAt: now,
        parserModel: PARSER_MODEL,
        parsedMarkdown: firstBlock.markdown,
      })

      // Video → derived audio block becomes a child of the video row,
      // not the chat group, mirroring the existing dropoff convention.
      for (let b = 1; b < parsed.blocks.length; b++) {
        const extra = parsed.blocks[b]
        await db.insert(sourceItem).values({
          id: randomUUID(),
          sourceId: wa.id,
          organizationId: wa.organizationId,
          externalId: `${externalId}:audio`,
          externalType: extra.kind === "video_audio" ? "derived_audio" : "attachment",
          parentSourceItemId: rootId,
          metadataJson: {
            provider: "whatsapp",
            contentHash: hash,
            ...extra.analysis,
          },
          filename: fileName,
          mimeType: extra.kind === "video_audio" ? "audio/mp4" : parsed.mediaType,
          sourceCreatedAt: now,
          fetchedAt: now,
          parseStatus: "complete",
          parsedAt: now,
          parserModel: PARSER_MODEL,
          parsedMarkdown: extra.markdown,
        })
      }

      attachmentResults.push({
        kind: "attachment",
        fileName,
        itemId: rootId,
        ok: true,
        inserted: true,
        parentItemId: parentRowId,
      })
    } catch (err) {
      attachmentResults.push(classifyUploadError(fileName, err))
    }
  }

  const okGroups = groupResults.length
  const okAttachments = attachmentResults.filter((r) => r.ok).length
  const failedAttachments = attachmentResults.filter((r) => !r.ok).length

  return NextResponse.json({
    chatFormat,
    groupCount: okGroups,
    attachmentCount: okAttachments,
    failedCount: failedAttachments,
    results: [...groupResults, ...attachmentResults] satisfies Result[],
  })
}

function classifyUploadError(fileName: string, err: unknown): FileFailure {
  if (err instanceof UnsupportedDropoffTypeError) {
    return {
      kind: "attachment",
      fileName,
      ok: false,
      reason: "unsupported",
      error: err.message,
    }
  }
  if (
    err instanceof UnsupportedImageTypeError ||
    err instanceof UnsupportedAudioTypeError ||
    err instanceof UnsupportedVideoTypeError ||
    err instanceof UnsupportedOfficeTypeError
  ) {
    return {
      kind: "attachment",
      fileName,
      ok: false,
      reason: "unsupported",
      error: err.message,
    }
  }
  if (
    err instanceof PdfTooLargeError ||
    err instanceof ImageTooLargeError ||
    err instanceof AudioTooLargeError ||
    err instanceof VideoTooLargeError ||
    err instanceof OfficeTooLargeError
  ) {
    return {
      kind: "attachment",
      fileName,
      ok: false,
      reason: "too_large",
      error: err.message,
    }
  }
  console.error("[whatsapp/upload] Parse failed", { fileName, err })
  return {
    kind: "attachment",
    fileName,
    ok: false,
    reason: "failed",
    error: err instanceof Error ? err.message : String(err),
  }
}
