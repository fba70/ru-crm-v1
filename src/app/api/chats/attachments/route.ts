import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, sourceItem } from "@/db/schema"
import { downloadChatAttachmentBytes } from "@/lib/google-chat"
import { getServerSession } from "@/lib/get-session"
import { getGchatCredentials } from "@/server/providers/credentials"

/**
 * Downloads a Google Chat attachment server-side using the source's
 * service-account credentials.
 *
 * The route resolves which gchat source row owns the attachment by:
 *   1. Extract the parent message resource from `resourceName`
 *      (`spaces/X/messages/Y/...` → `spaces/X/messages/Y`).
 *   2. Find the `source_item` where `external_id = <message resource>`
 *      AND `organization_id = <active org>`. Tenant scope guarantees
 *      a session in org A can never pull bytes belonging to org B.
 *   3. Read credentials from the joined source row and pass to
 *      `downloadChatAttachmentBytes`.
 *
 * The link Google provides in the message response (`downloadUri`) is
 * a human-browser URL that requires the viewing user to be a member of
 * the chat space — bot spaces aren't shared with humans, so the link
 * 403s. We proxy the bytes through our backend where the service
 * account already has the necessary Chat scope.
 */
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
    const resourceName = searchParams.get("resourceName")
    const filename = searchParams.get("filename") || "download"
    const contentType =
      searchParams.get("contentType") || "application/octet-stream"

    if (!resourceName) {
      return NextResponse.json(
        { error: "resourceName is required" },
        { status: 400 },
      )
    }

    // Extract `spaces/<id>/messages/<id>` prefix — the parent message
    // resource we stored in `source_item.external_id` at sync time.
    const messageMatch = resourceName.match(
      /^(spaces\/[^/]+\/messages\/[^/]+)/,
    )
    if (!messageMatch) {
      return NextResponse.json(
        { error: "Invalid resourceName — expected to begin with spaces/<id>/messages/<id>/…" },
        { status: 400 },
      )
    }
    const messageResource = messageMatch[1]

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
          eq(sourceItem.externalId, messageResource),
          eq(sourceItem.organizationId, activeOrgId),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) {
      return NextResponse.json(
        { error: "Attachment's source not found in this organization" },
        { status: 404 },
      )
    }
    if (row.provider !== "gchat") {
      return NextResponse.json(
        { error: `Source provider is ${row.provider}, expected gchat` },
        { status: 400 },
      )
    }

    const creds = getGchatCredentials(row.sourceId, row.credentialsRef)
    const bytes = await downloadChatAttachmentBytes(creds, resourceName)

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[chat-attachment] download failed", { error })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
