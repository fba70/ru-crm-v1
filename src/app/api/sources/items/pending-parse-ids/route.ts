import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { listPendingParseItemIds } from "@/server/source-items"

// Returns ids of org's items eligible for batch parsing — i.e. root
// rows whose `parseStatus = 'pending'`. Powers the "Parse all" control
// on the Pending table. Same filter context as `/api/sources/items`
// (sourceId, q, dateFrom, dateTo, scope) so the batch matches what
// the user can see in the table.
//
// Auth: any authenticated session with an active org. The per-item
// Parse route (`/api/sources/items/[id]/parse`) re-verifies tenant
// scope, so this endpoint just narrows the candidate list.
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)

  const scopeParam = searchParams.get("scope")
  const scope = scopeParam === "system" ? "system" : "org"
  const organizationId = scope === "system" ? null : activeOrgId

  const sourceId = searchParams.get("sourceId") ?? undefined
  const filenameSearch = searchParams.get("q") ?? undefined

  const dateFromStr = searchParams.get("date_from")
  const dateToStr = searchParams.get("date_to")
  const dateFrom = dateFromStr ? new Date(`${dateFromStr}T00:00:00.000Z`) : undefined
  const dateTo = dateToStr ? new Date(`${dateToStr}T23:59:59.999Z`) : undefined

  try {
    const result = await listPendingParseItemIds({
      organizationId,
      scope,
      sourceId,
      filenameSearch,
      dateFrom,
      dateTo,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[items/pending-parse-ids] Error:", error)
    const message =
      error instanceof Error ? error.message : "Failed to list pending items"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
