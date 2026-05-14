import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { runDailyPipeline } from "@/server/orchestration/daily-pipeline"

// Admin "Run pipeline now" — same orchestration the cron-fired workflow
// uses, just synchronous and HTTP-triggered. Useful for testing the
// full sync → parse → upload chain without waiting for 03:00 UTC.
//
// maxDuration is generous because phase 2 (parse) can chew through up
// to `maxParsePerRun` items, some of which are videos. In practice the
// workflow path should be preferred for any large run.
export const maxDuration = 800

export async function POST() {
  const session = await getServerSession()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const result = await runDailyPipeline({ trigger: "manual" })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[admin/pipeline/run] Error:", error)
    const message =
      error instanceof Error ? error.message : "Pipeline run failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
