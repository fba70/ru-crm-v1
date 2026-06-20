import { NextRequest, NextResponse } from "next/server"
import {
  listBlocklist,
  canManageBlocklist,
  addBlocklistEntry,
  BlocklistError,
} from "@/server/blocklist"
import type { BlocklistKind } from "@/db/schema"

export { type BlocklistEntry } from "@/server/blocklist"

const KINDS: BlocklistKind[] = ["email", "domain", "company", "person"]

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
  console.error("[blocklist] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

// List entries (any member) + whether the caller may manage them (owner).
export async function GET() {
  try {
    const [entries, canManage] = await Promise.all([
      listBlocklist(),
      canManageBlocklist(),
    ])
    return NextResponse.json({ entries, canManage })
  } catch (error) {
    return errorResponse(error)
  }
}

// Add an entry (owner). Returns the swept-row counts so the UI can toast them.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const b = (body ?? {}) as Record<string, unknown>
    const kind = typeof b.kind === "string" ? (b.kind as BlocklistKind) : null
    const value = typeof b.value === "string" ? b.value : null
    if (!kind || !KINDS.includes(kind) || !value) {
      return NextResponse.json(
        { error: "kind and value are required" },
        { status: 400 },
      )
    }
    const result = await addBlocklistEntry({
      kind,
      value,
      note: typeof b.note === "string" ? b.note : null,
      sourceItemId: typeof b.sourceItemId === "string" ? b.sourceItemId : null,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
