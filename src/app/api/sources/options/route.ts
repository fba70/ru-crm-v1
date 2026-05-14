import { NextResponse } from "next/server"
import { listOrgSources } from "@/server/sources"
import { getServerSession } from "@/lib/get-session"

// Lightweight org-scoped source list for picker UIs (Explore-sources
// dialog, future filters, etc). Any authenticated org member can call;
// the existing /api/sources/org route is owner-only and returns more
// data than a picker needs.
export async function GET() {
  try {
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const orgId = session.session.activeOrganizationId
    if (!orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      )
    }
    const sources = await listOrgSources(orgId)
    return NextResponse.json({ sources })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
