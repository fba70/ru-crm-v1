import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { uploadSourceItem } from "@/server/r2/upload-source-item"
import {
  assertSourceItemInScope,
  SourceItemScopeError,
} from "@/server/source-items"

export const maxDuration = 30

// Thin org-scoped wrapper around `uploadSourceItem`. The actual R2 put
// + status-stamping logic lives in the server function so the daily
// orchestration pipeline can call it without going through HTTP.
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let sourceItemId: string | undefined
  try {
    const body = await request.json()
    sourceItemId =
      typeof body?.sourceItemId === "string" ? body.sourceItemId : undefined
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!sourceItemId) {
    return NextResponse.json(
      { error: "sourceItemId is required" },
      { status: 400 },
    )
  }

  try {
    await assertSourceItemInScope(sourceItemId, activeOrgId)
  } catch (error) {
    if (error instanceof SourceItemScopeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 403 },
      )
    }
    throw error
  }

  const result = await uploadSourceItem(sourceItemId)
  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "r2_failed"
          ? 500
          : 400
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({
    key: result.key,
    sizeBytes: result.sizeBytes,
    uploadedAt: result.uploadedAt.toISOString(),
  })
}
