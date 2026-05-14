import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, sourceItem } from "@/db/schema"
import nylas from "@/lib/nylas"
import { getServerSession } from "@/lib/get-session"
import { getNylasCredentials } from "@/server/providers/credentials"

/**
 * Downloads a Nylas email attachment server-side using the source's
 * per-mailbox grant id (from `credentials_ref`, not env).
 *
 * Tenant scope: the route resolves which nylas source row owns the
 * attachment by joining `source_item` where `external_id = messageId`
 * AND `organization_id = <active org>`. Cross-org access via a guessed
 * messageId is impossible — the join returns nothing.
 *
 * Mirrors the auth + lookup pattern used by `/api/chats/attachments`
 * and `/api/drive/download` after Phase 3.
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
    const attachmentId = searchParams.get("attachmentId")
    const messageId = searchParams.get("messageId")

    if (!attachmentId || !messageId) {
      return NextResponse.json(
        { error: "attachmentId and messageId are required" },
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
          eq(sourceItem.externalId, messageId),
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
    if (row.provider !== "nylas") {
      return NextResponse.json(
        { error: `Source provider is ${row.provider}, expected nylas` },
        { status: 400 },
      )
    }

    const { grantId } = getNylasCredentials(row.sourceId, row.credentialsRef)

    const buffer = await nylas.attachments.downloadBytes({
      identifier: grantId,
      attachmentId,
      queryParams: { messageId },
    })

    // Get attachment metadata for filename and content type
    const metadata = await nylas.attachments.find({
      identifier: grantId,
      attachmentId,
      queryParams: { messageId },
    })

    const filename = metadata.data.filename ?? "download"
    const contentType =
      metadata.data.contentType ?? "application/octet-stream"

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error("[email-attachment] download failed", { error })
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
