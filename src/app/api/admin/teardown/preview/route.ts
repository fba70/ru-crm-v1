import { NextRequest, NextResponse } from "next/server"
import { previewSourceTeardown, TeardownError } from "@/server/teardown"

export {
  type TeardownPreview,
  type TeardownThread,
  type TeardownEntity,
} from "@/server/teardown"

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
  console.error("[admin/teardown/preview] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

// Dry-run blast radius for one source.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const sourceId =
      body && typeof body.sourceId === "string" ? body.sourceId : null
    if (!sourceId) {
      return NextResponse.json(
        { error: "sourceId is required" },
        { status: 400 },
      )
    }
    const preview = await previewSourceTeardown(sourceId)
    return NextResponse.json(preview)
  } catch (error) {
    return errorResponse(error)
  }
}
