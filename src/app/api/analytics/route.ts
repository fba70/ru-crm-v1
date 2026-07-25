import { NextRequest, NextResponse } from "next/server"
import { getSalesAnalytics, getAnalyticsBounds } from "@/server/analytics"

export {
  type SalesAnalytics,
  type AnalyticsTotals,
  type TimePoint,
  type SliceRow,
  type StackPoint,
  type StatusRow,
  type ClientScatterPoint,
  type ProductRow,
} from "@/server/analytics"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

// GET /api/analytics?bounds=1        → { first, last } order dates in the org
// GET /api/analytics?from=&to=       → the full analytics payload
//
// Org scope comes from the session inside the server layer — never from the
// query string — so one org can't read another's numbers by guessing an id.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    if (searchParams.get("bounds") === "1") {
      return NextResponse.json(await getAnalyticsBounds())
    }

    const from = searchParams.get("from")
    const to = searchParams.get("to")
    if (!from || !to) {
      return NextResponse.json(
        { error: "Both `from` and `to` are required" },
        { status: 400 },
      )
    }

    return NextResponse.json(await getSalesAnalytics({ from, to }))
  } catch (error) {
    return errorResponse(error)
  }
}
