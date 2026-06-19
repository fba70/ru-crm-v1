import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { listProcessItemIds } from "@/server/source-items"

// Returns ids of the org's items needing ANY work (parse or upload) in
// the current filter context — powers the merged "Обработать все (N)"
// control. Same filter params as `/api/sources/items` (sourceId, q,
// date range, scope). The per-item `/process` route re-verifies tenant
// scope, so this just narrows the candidate list.
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
    const result = await listProcessItemIds({
      organizationId,
      scope,
      sourceId,
      filenameSearch,
      dateFrom,
      dateTo,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[items/process-ids] Error:", error)
    const message =
      error instanceof Error ? error.message : "Failed to list items"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
