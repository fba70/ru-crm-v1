import { NextResponse } from "next/server"
import { listTeardownSources, TeardownError } from "@/server/teardown"

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
  console.error("[admin/teardown/sources] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

// Admin-only source picker for the teardown tool (cross-org).
export async function GET() {
  try {
    const sources = await listTeardownSources()
    return NextResponse.json({ sources })
  } catch (error) {
    return errorResponse(error)
  }
}
