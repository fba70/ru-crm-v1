import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { getPipelineStats } from "@/server/pipeline-runs"

// Read-side companion to /api/admin/pipeline/run. Powers the
// "Workflow Statistics" card on the Sources page. Aggregates
// `pipeline_run` rows in the requested window into:
//   { totals, runs, errors }
// so the client can render the metric tiles, runs mini-list, and the
// flattened errors table in one round-trip. Pagination of the errors
// table is client-side because the absolute upper bound is
// `maxErrorsPerRun (200) × runs in window` — small enough to ship in
// one payload at the volumes we expect.
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const fromStr = searchParams.get("from")
  const toStr = searchParams.get("to")
  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: "from and to are required (ISO timestamps)" },
      { status: 400 },
    )
  }
  const from = new Date(fromStr)
  const to = new Date(toStr)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json(
      { error: "Invalid timestamp — pass ISO 8601 strings" },
      { status: 400 },
    )
  }

  try {
    const stats = await getPipelineStats(from, to)
    return NextResponse.json(stats)
  } catch (err) {
    console.error("[admin/pipeline/stats] error:", err)
    const message = err instanceof Error ? err.message : "Failed to load stats"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
