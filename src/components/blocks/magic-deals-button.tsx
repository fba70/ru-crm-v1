"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { DEFAULT_MODEL_KEY } from "@/lib/llm-models"
import type { RuleRow } from "@/app/api/rules/route"
import type { GenerateDealsResult } from "@/app/api/deals/discover/route"

// One-click "Magic" — runs the exact same deal-discovery flow as
// <DiscoverDealsDialog>, but with everything pre-decided so there's no
// intermediate dialog:
//   • period  → last day (rolling 24h — matches client/contact discovery's
//     periodCutoff("last_day"); see rolling24hCutoffIso below)
//   • sources → all organization sources (sourceIds: null)
//   • rule    → "Funnel Processing Rule" (resolved by name)
//   • model   → Gemini 2.5 Flash (DEFAULT_MODEL_KEY)
//   • already-analyzed items are skipped (the default)
const MAGIC_RULE_NAME = "Funnel Processing Rule"
const MAGIC_MODEL_KEY = DEFAULT_MODEL_KEY // "gemini-2.5-flash"

// Rolling 24h cutoff, mirroring discovery's periodCutoff("last_day"). The
// deals API takes a from/to date-time (not a `period`), so we send this cutoff
// as `from` (full ISO timestamp) with no upper bound (`to: null`) →
// sourceCreatedAt >= now-24h, identical to the discovery Magic button.
function rolling24hCutoffIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
}

export function MagicDealsButton({
  onDealsGenerated,
}: {
  onDealsGenerated: () => void
}) {
  const [running, setRunning] = useState(false)

  const handleClick = async () => {
    setRunning(true)
    try {
      // Resolve the fixed rule by name against the active org's Custom rules.
      const rRes = await fetch("/api/rules?type=Custom&activeOrgOnly=1")
      if (!rRes.ok) {
        toast.error("Не удалось загрузить правила")
        return
      }
      const rData = await rRes.json()
      const rules: RuleRow[] = rData.rules ?? []
      const rule =
        rules.find((r) => r.name === MAGIC_RULE_NAME) ??
        rules.find((r) => r.name.toLowerCase().includes("funnel processing"))
      if (!rule) {
        toast.error(`Правило «${MAGIC_RULE_NAME}» не найдено в организации`)
        return
      }

      const res = await fetch("/api/deals/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: rolling24hCutoffIso(),
          to: null,
          sourceIds: null, // all organization sources
          ruleId: rule.id,
          modelKey: MAGIC_MODEL_KEY,
          includeAlreadyAnalyzed: false,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Не удалось выполнить поиск сделок")
        return
      }
      const r = data.result as GenerateDealsResult
      if (r.errors && r.errors.length > 0) {
        console.warn("[magic-deals] per-item errors:", r.errors)
      }
      const skippedTotal =
        r.skippedNotRelevant +
        r.skippedNoMarkdown +
        r.skippedUnknownClient +
        r.skippedUnknownStage +
        r.skippedUnknownDeal +
        r.skippedDuplicate
      const summary =
        `Создано ${r.dealsCreated} · обновлений этапа ${r.stageUpdates} · ` +
        `просмотрено ${r.scanned} · пропущено ${skippedTotal}`
      if (r.capped > 0) {
        toast.success(
          `${summary} (достигнут предел — ${r.capped} не проанализировано)`,
          { duration: 8000 },
        )
      } else if (r.failed > 0) {
        toast.warning(`${summary} · ошибок: ${r.failed}`, { duration: 8000 })
      } else {
        toast.success(summary)
      }
      onDealsGenerated()
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось выполнить поиск сделок",
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <Button size="sm" onClick={handleClick} disabled={running}>
      {running ? (
        <>
          <Loader className="h-4 w-4 mr-1 animate-spin" />
          Магия…
        </>
      ) : (
        <>
          <Wand2 className="h-4 w-4 mr-1" />
          Magic
        </>
      )}
    </Button>
  )
}
