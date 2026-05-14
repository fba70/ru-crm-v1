import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { db } from "@/db/drizzle"
import { sourceItem } from "@/db/schema"
import { getMarkdownFromR2 } from "@/lib/r2"
import {
  assertSourceItemInScope,
  SourceItemScopeError,
} from "@/server/source-items"

// Returns the parsed markdown for a single source_item. Two storage
// locations are checked in order:
//   1. `parsed_markdown` column — populated immediately after Parse,
//      cleared on a successful R2 upload.
//   2. R2 by `markdown_r2_key` — for rows that have been uploaded.
// Used by the Show modal in both Pending and Processed tables.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }

  try {
    await assertSourceItemInScope(id, activeOrgId)
  } catch (error) {
    if (error instanceof SourceItemScopeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 403 },
      )
    }
    throw error
  }

  const rows = await db
    .select({
      parseStatus: sourceItem.parseStatus,
      parsedMarkdown: sourceItem.parsedMarkdown,
      markdownR2Key: sourceItem.markdownR2Key,
      parseError: sourceItem.parseError,
    })
    .from(sourceItem)
    .where(eq(sourceItem.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return NextResponse.json({ error: "Source item not found" }, { status: 404 })
  }

  if (row.parseStatus === "skipped" || row.parseStatus === "failed") {
    return NextResponse.json(
      {
        error: `No markdown for status '${row.parseStatus}'`,
        parseStatus: row.parseStatus,
        parseError: row.parseError,
      },
      { status: 404 },
    )
  }

  if (row.parsedMarkdown) {
    return NextResponse.json({ markdown: row.parsedMarkdown, source: "db" })
  }
  if (row.markdownR2Key) {
    try {
      const markdown = await getMarkdownFromR2(row.markdownR2Key)
      return NextResponse.json({ markdown, source: "r2" })
    } catch (error) {
      console.error("[items/markdown] R2 fetch error:", error)
      const message =
        error instanceof Error ? error.message : "Failed to fetch from R2"
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }
  return NextResponse.json(
    { error: "Markdown not available (not parsed yet?)" },
    { status: 404 },
  )
}
