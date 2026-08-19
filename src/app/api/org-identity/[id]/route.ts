import { NextResponse } from "next/server"
import {
  removeOrgIdentityEntry,
  OrgIdentityError,
} from "@/server/org-identity-registry"

function errorResponse(error: unknown) {
  if (error instanceof OrgIdentityError) {
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
  console.error("[org-identity/[id]] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

// Remove a registry entry (owner). Rows previously created under this identity
// are NOT touched — the dialog reports them and the owner decides.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    await removeOrgIdentityEntry(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
