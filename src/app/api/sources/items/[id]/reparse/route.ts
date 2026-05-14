import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { reparseSourceItem } from "@/server/parse-source-item"
import {
  assertSourceItemInScope,
  SourceItemScopeError,
} from "@/server/source-items"

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
    await reparseSourceItem(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof SourceItemScopeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 403 },
      )
    }
    console.error("[items/reparse] Error:", error)
    const message = error instanceof Error ? error.message : "Re-parse failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
