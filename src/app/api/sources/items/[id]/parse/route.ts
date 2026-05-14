import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { parseSourceItem } from "@/server/parse-source-item"
import {
  assertSourceItemInScope,
  SourceItemScopeError,
} from "@/server/source-items"

// Video parsing (visual + diarised transcription) is the slowest path
// and dominates wall-clock for any item that includes one.
export const maxDuration = 300

export async function POST(
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
    const result = await parseSourceItem(id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SourceItemScopeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 403 },
      )
    }
    console.error("[items/parse] Error:", error)
    const message = error instanceof Error ? error.message : "Parse failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
