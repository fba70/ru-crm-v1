import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { syncSource } from "@/server/sync"
import { assertSourceInScope, SourceScopeError } from "@/server/sources"

// Sync calls Drive/Chat/Nylas APIs and runs N upserts; for the system
// sources at SYNC_PAGE_LIMIT=100 this comfortably finishes well under
// the default Vercel timeout, but bump headroom in case a provider is
// slow.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let sourceId: string | undefined
  // Optional explicit fetch window (YYYY-MM-DD or ISO). When set, sync does a
  // BOUNDED backfill of that range instead of the incremental high-water-mark
  // pull — the only way to re-pull historical mail that's already behind the
  // cursor (e.g. a source_item row hard-deleted for a test). See SyncOptions.
  let sinceIso: string | undefined
  let untilIso: string | undefined
  try {
    const body = await request.json()
    sourceId = typeof body?.sourceId === "string" ? body.sourceId : undefined
    sinceIso = typeof body?.sinceIso === "string" ? body.sinceIso : undefined
    untilIso = typeof body?.untilIso === "string" ? body.untilIso : undefined
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!sourceId) {
    return NextResponse.json(
      { error: "sourceId is required" },
      { status: 400 },
    )
  }

  try {
    await assertSourceInScope(sourceId, activeOrgId)
    const result = await syncSource(sourceId, { sinceIso, untilIso })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SourceScopeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 403 },
      )
    }
    console.error("[sources/sync] Error:", error)
    const message =
      error instanceof Error ? error.message : "Sync failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
