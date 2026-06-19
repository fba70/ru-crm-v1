import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { processSourceItem } from "@/server/process-source-item"
import {
  assertSourceItemInScope,
  SourceItemScopeError,
} from "@/server/source-items"

// One-shot parse → upload (→ ship child rows) for a single item. Video
// parsing dominates wall-clock, so the same 300s budget as the parse
// route. `processSourceItem` never throws — failures come back on the
// JSON `ok`/`error` fields so the client batch loop can isolate them.
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
    const result = await processSourceItem(id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SourceItemScopeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 403 },
      )
    }
    console.error("[items/process] Error:", error)
    const message = error instanceof Error ? error.message : "Processing failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
