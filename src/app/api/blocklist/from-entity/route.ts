import { NextRequest, NextResponse } from "next/server"
import { blacklistEntity, BlocklistError } from "@/server/blocklist"

function errorResponse(error: unknown) {
  if (error instanceof BlocklistError) {
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
  console.error("[blocklist/from-entity] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

// Blacklist an existing client/contact row (owner): derives entries from the
// row + sweeps (which also flips the row to `blocked`).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const b = (body ?? {}) as Record<string, unknown>
    const entityType =
      b.entityType === "client" || b.entityType === "contact"
        ? b.entityType
        : null
    const id = typeof b.id === "string" ? b.id : null
    if (!entityType || !id) {
      return NextResponse.json(
        { error: "entityType ('client'|'contact') and id are required" },
        { status: 400 },
      )
    }
    const result = await blacklistEntity({ entityType, id })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
