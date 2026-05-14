import { type VercelConfig } from "@vercel/config/v1"

// Vercel project config — replaces the older `vercel.json`.
//
// **Schedule duplication is intentional.** Vercel's `vercel.ts`
// evaluator validates the JSON output before runtime imports resolve —
// referencing `ORCHESTRATION_CONFIG.cron` from the orchestration
// config file produced `schedule: undefined` on deploy and tripped the
// platform's "crons[0] missing required property `schedule`" check.
//
// Source of truth for the cron expression at deploy time: this file.
// Source of truth at runtime: `src/server/orchestration/config.ts`
// (read by the orchestration server functions and surfaced in
// PHASE2.md "Pipeline tuning"). **If you change one, change the
// other.** PHASE2 #12 tracks lifting both copies into a
// system_settings dictionary so this duplication goes away.
//
// The `/api/cron/daily` route validates `Authorization: Bearer
// $CRON_SECRET` (production only). Vercel attaches this header
// automatically when `CRON_SECRET` is set as a project env var.
export const config: VercelConfig = {
  crons: [
    {
      path: "/api/cron/daily",
      schedule: "0 3 * * *", // daily at 03:00 UTC — keep in sync with ORCHESTRATION_CONFIG.cron
    },
  ],
}
