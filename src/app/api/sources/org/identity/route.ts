import { NextRequest, NextResponse } from "next/server"
import {
  updateOwnerOrgSourceIdentity,
  OrgOwnerError,
  SourceScopeError,
  type OwnerOrgSourceIdentityUpdate,
} from "@/server/sources"

// Owner-only identity update: name + description.
// Body: { sourceId, name?, description? }
export async function PATCH(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const sourceId = typeof b.sourceId === "string" ? b.sourceId : null
  if (!sourceId) {
    return NextResponse.json(
      { error: "sourceId is required" },
      { status: 400 },
    )
  }

  const patch: OwnerOrgSourceIdentityUpdate = {}
  if (b.name !== undefined) {
    if (typeof b.name !== "string") {
      return NextResponse.json(
        { error: "name must be a string" },
        { status: 400 },
      )
    }
    patch.name = b.name
  }
  if (b.description !== undefined) {
    if (b.description !== null && typeof b.description !== "string") {
      return NextResponse.json(
        { error: "description must be a string or null" },
        { status: 400 },
      )
    }
    patch.description = b.description as string | null
  }

  try {
    await updateOwnerOrgSourceIdentity(sourceId, patch)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof OrgOwnerError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "unauthorized" ? 401 : 403 },
      )
    }
    if (error instanceof SourceScopeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 403 },
      )
    }
    console.error("[sources/org/identity] Error:", error)
    const message = error instanceof Error ? error.message : "Request failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
