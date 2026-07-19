import { NextResponse } from "next/server"
import { removeBlocklistEntry, BlocklistError } from "@/server/blocklist"

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
  console.error("[blocklist/[id]] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

// Remove an entry (owner). Does NOT un-hide previously swept rows.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    await removeBlocklistEntry(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
