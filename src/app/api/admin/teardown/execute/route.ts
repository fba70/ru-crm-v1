import { NextRequest, NextResponse } from "next/server"
import { executeSourceTeardown, TeardownError } from "@/server/teardown"

// R2 batch deletes + source-item deletions can be sizeable on a big source.
export const maxDuration = 300

function errorResponse(error: unknown) {
  if (error instanceof TeardownError) {
    const status =
      error.reason === "unauthorized"
        ? 401
        : error.reason === "forbidden"
          ? 403
          : error.reason === "not_found"
            ? 404
            : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  console.error("[admin/teardown/execute] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

// Hard-delete the selected threads (parent source_items + children) of a source
// and the artifacts EXCLUSIVELY produced by them. Body:
// { sourceId, confirmText, threadIds[] }.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const b = (body ?? {}) as Record<string, unknown>
    const sourceId = typeof b.sourceId === "string" ? b.sourceId : null
    const confirmText = typeof b.confirmText === "string" ? b.confirmText : null
    if (!sourceId || confirmText === null) {
      return NextResponse.json(
        { error: "sourceId and confirmText are required" },
        { status: 400 },
      )
    }
    const asIds = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
    const result = await executeSourceTeardown({
      sourceId,
      confirmText,
      threadIds: asIds(b.threadIds),
    })
    return NextResponse.json({ counts: result })
  } catch (error) {
    return errorResponse(error)
  }
}
