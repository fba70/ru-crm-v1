import { NextRequest, NextResponse } from "next/server"
import {
  listOwnerOrgSources,
  updateOwnerOrgSource,
  OrgOwnerError,
  SourceScopeError,
  type OwnerOrgSourceUpdate,
} from "@/server/sources"
import type { SourceStatus } from "@/db/schema"

const STATUSES: SourceStatus[] = ["active", "inactive"]

// Org-owner-only sources management. GET returns the editable list;
// PATCH flips Auto Parse and/or status on a single source. The server
// helpers do the role + tenant-scope checks; this route is just the
// HTTP shell + body parsing.
export async function GET() {
  try {
    const sources = await listOwnerOrgSources()
    return NextResponse.json({ sources })
  } catch (error) {
    return errorResponse(error)
  }
}

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

  const update: OwnerOrgSourceUpdate = {}
  if (typeof b.automatedParsingIsAllowed === "boolean") {
    update.automatedParsingIsAllowed = b.automatedParsingIsAllowed
  }
  if (
    typeof b.status === "string" &&
    STATUSES.includes(b.status as SourceStatus)
  ) {
    update.status = b.status as SourceStatus
  }

  try {
    await updateOwnerOrgSource(sourceId, update)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}

function errorResponse(error: unknown) {
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
  console.error("[sources/org] Error:", error)
  const message = error instanceof Error ? error.message : "Request failed"
  return NextResponse.json({ error: message }, { status: 500 })
}
