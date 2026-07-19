import { NextRequest, NextResponse } from "next/server"
import { listPendingEnrichIds } from "@/server/clients"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

// The batch worklist + count for the "Enrich clients (N)" button.
export async function GET(request: NextRequest) {
  try {
    const limitParam = new URL(request.url).searchParams.get("limit")
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 200
    const result = await listPendingEnrichIds(
      Number.isFinite(limit) && limit > 0 ? limit : 200,
    )
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
