import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, sourceItem } from "@/db/schema"
import { getDriveClient } from "@/lib/google-drive"
import { getServerSession } from "@/lib/get-session"
import { getGdriveCredentials } from "@/server/providers/credentials"

/**
 * Streams a Google Drive file's bytes through our backend with a
 * Content-Disposition: attachment header so the browser downloads
 * instead of rendering (what `webViewLink` does).
 *
 * Tenant scope: the source is resolved by joining `source_item` with
 * `external_id = <fileId>` AND `organization_id = <active org>`, so a
 * session in org A can never pull bytes belonging to org B even if the
 * caller guesses a fileId.
 *
 * Google-native types (Docs / Sheets / Slides / Drawings) can't be
 * fetched with `alt=media` — they're not stored as binary files. We
 * export them to a parseable format (PDF by default; Sheets → XLSX).
 * Everything else uses plain media download.
 */

// Prefer markdown where Google supports it (Docs only, since 2024).
// Sheets / Slides / Drawings don't offer markdown export — keep their best
// structured-parseable alternatives.
const EXPORT_MAP: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": {
    mime: "text/markdown",
    ext: "md",
  },
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mime: "application/pdf",
    ext: "pdf",
  },
  "application/vnd.google-apps.drawing": {
    mime: "application/pdf",
    ext: "pdf",
  },
}

function sanitizeFilename(name: string): string {
  // Strip quotes and control chars so the Content-Disposition header stays valid.
  return name.replace(/[\r\n"]/g, "").trim() || "download"
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const activeOrgId = session.session.activeOrganizationId
    if (!activeOrgId) {
      return NextResponse.json(
        { error: "No active organization on session" },
        { status: 401 },
      )
    }

    const { searchParams } = new URL(request.url)
    const fileId = searchParams.get("fileId")
    if (!fileId) {
      return NextResponse.json(
        { error: "fileId is required" },
        { status: 400 },
      )
    }

    const rows = await db
      .select({
        sourceId: source.id,
        provider: source.provider,
        credentialsRef: source.credentialsRef,
      })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(
        and(
          eq(sourceItem.externalId, fileId),
          eq(sourceItem.organizationId, activeOrgId),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) {
      return NextResponse.json(
        { error: "File's source not found in this organization" },
        { status: 404 },
      )
    }
    if (row.provider !== "gdrive") {
      return NextResponse.json(
        { error: `Source provider is ${row.provider}, expected gdrive` },
        { status: 400 },
      )
    }

    const creds = getGdriveCredentials(row.sourceId, row.credentialsRef)
    const drive = getDriveClient(creds)

    // Metadata first — name + mimeType drive both the export decision and the
    // downloaded filename/content-type.
    const meta = await drive.files.get({
      fileId,
      fields: "id,name,mimeType",
      supportsAllDrives: true,
    })

    const name = sanitizeFilename(meta.data.name ?? "download")
    const sourceMime = meta.data.mimeType ?? ""
    const exportSpec = EXPORT_MAP[sourceMime]

    let buffer: ArrayBuffer
    let contentType: string
    let filename: string

    if (exportSpec) {
      const response = await drive.files.export(
        { fileId, mimeType: exportSpec.mime },
        { responseType: "arraybuffer" },
      )
      buffer = response.data as unknown as ArrayBuffer
      contentType = exportSpec.mime
      filename = `${name}.${exportSpec.ext}`
    } else if (sourceMime === "application/vnd.google-apps.folder") {
      return NextResponse.json(
        { error: "Cannot download a folder" },
        { status: 400 },
      )
    } else if (sourceMime === "application/vnd.google-apps.form") {
      return NextResponse.json(
        { error: "Google Forms cannot be exported as files" },
        { status: 400 },
      )
    } else if (sourceMime === "application/vnd.google-apps.shortcut") {
      return NextResponse.json(
        { error: "Cannot download a shortcut directly" },
        { status: 400 },
      )
    } else {
      const response = await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" },
      )
      buffer = response.data as unknown as ArrayBuffer
      contentType = sourceMime || "application/octet-stream"
      filename = name
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[drive-download] failed", { error })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
