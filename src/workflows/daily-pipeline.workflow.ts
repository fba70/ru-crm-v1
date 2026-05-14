import { runDailyPipeline } from "@/server/orchestration/daily-pipeline"

// THIS IS THE ONLY FILE THAT TOUCHES THE VERCEL WORKFLOW SDK.
//
// Detachability: when we move off Vercel, delete this file + the cron
// route that calls `start()` and replace with whatever scheduler the
// new host uses (BullMQ job, Trigger.dev task, plain `setInterval`,
// systemd timer hitting an admin endpoint, …). Everything imported
// below — `runDailyPipeline`, `parseSourceItem`, `uploadSourceItem`,
// the orchestration listers — stays unchanged. The vendor lock lives
// here, in two directives, and nowhere else.
//
// Design: ONE coarse step that calls the engine-agnostic
// `runDailyPipeline`. Trade-offs:
//   • Pro — pipeline_run owns observability portably; one row per run.
//     Workflow→step→workflow boundaries don't fragment the audit trail.
//   • Pro — minimum surface area for the vendor SDK.
//   • Con — workflow-level retry of this step would re-enter
//     `runDailyPipeline` and create a SECOND pipeline_run row. In
//     practice runs almost never crash mid-execution because
//     parseSourceItem / uploadSourceItem already swallow per-item
//     errors; if we start seeing this, the fix is a stale-run sweep
//     keyed on `status='running' AND started_at < now() - 1h`, not a
//     workflow-shape change.
//
// PHASE2 follow-up (not now): if we ever need per-item retry granularity
// (e.g. a flaky video parse should re-attempt without re-doing sync),
// the upgrade path is to fan out per-id steps inside the workflow. The
// orchestration listers (`listPendingParseIds`, `listPendingUploadIds`)
// were designed for that exact split.

export async function dailyPipelineWorkflow() {
  "use workflow"

  const result = await runDailyPipelineStep()
  return result
}

async function runDailyPipelineStep() {
  "use step"
  return await runDailyPipeline({ trigger: "cron" })
}
