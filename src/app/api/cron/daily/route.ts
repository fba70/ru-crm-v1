import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"
import { dailyPipelineWorkflow } from "@/workflows/daily-pipeline.workflow"

// Cron-triggered entrypoint. Vercel Cron Jobs hit this route on the
// schedule declared in `vercel.ts` (ORCHESTRATION_CONFIG.cron). When
// `CRON_SECRET` is set as a project env var, Vercel attaches
// `Authorization: Bearer $CRON_SECRET` to every scheduled invocation —
// rejecting anything else keeps the route off the open internet.
//
// In development we skip the auth check so the admin "Run pipeline now"
// button OR a local curl can hit it without setting up the header.
//
// The route is intentionally tiny: validate, kick off the workflow,
// return. The workflow itself takes over from there (Fluid Compute,
// durable steps, observability dashboard). Doing more here would push
// orchestration logic into the route, defeating the whole point of the
// detachable orchestration layer.
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    const auth = request.headers.get("authorization")
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 })
    }
  }

  try {
    await start(dailyPipelineWorkflow, [])
    return NextResponse.json({ ok: true, started: true })
  } catch (error) {
    console.error("[cron/daily] Failed to start workflow:", error)
    const message =
      error instanceof Error ? error.message : "Failed to start workflow"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
