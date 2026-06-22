"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { DEFAULT_MODEL_KEY } from "@/lib/llm-models"
import type { RuleRow } from "@/app/api/rules/route"

// One-click "Magic" — runs the exact same card-generation flow as
// <ExploreSourcesDialog>, but with everything pre-decided so there's no
// intermediate dialog:
//   • period  → last day (yesterday → today)
//   • sources → all organization sources (sourceIds: null)
//   • rule    → "Cards pop-up rule — Telegram orders" (resolved by name)
//   • model   → Gemini 2.5 Flash (DEFAULT_MODEL_KEY)
//   • already-analyzed items are skipped (the default)
const MAGIC_RULE_NAME = "Cards pop-up rule — Telegram orders"
const MAGIC_MODEL_KEY = DEFAULT_MODEL_KEY // "gemini-2.5-flash"

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoNDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export function MagicCardsButton({
  onCardsGenerated,
}: {
  onCardsGenerated: () => void
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
        rules.find((r) =>
          r.name.toLowerCase().includes("telegram orders"),
        )
      if (!rule) {
        toast.error(`Правило «${MAGIC_RULE_NAME}» не найдено в организации`)
        return
      }

      const res = await fetch("/api/cards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: isoNDaysAgo(1),
          to: todayIso(),
          sourceIds: null, // all organization sources
          ruleId: rule.id,
          modelKey: MAGIC_MODEL_KEY,
          includeAlreadyAnalyzed: false,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Не удалось сгенерировать карточки")
        return
      }
      const r = data.result as {
        scanned: number
        cardsCreated: number
        skippedNotRelevant: number
        skippedNoMarkdown: number
        failed: number
        capped: number
        errors: { sourceItemId: string; message: string }[]
      }
      if (r.errors && r.errors.length > 0) {
        console.warn("[magic-cards] per-item errors:", r.errors)
      }
      const summary = `Создано ${r.cardsCreated} ${plural(r.cardsCreated, [
        "карточка",
        "карточки",
        "карточек",
      ])} · просмотрено ${r.scanned} · пропущено ${r.skippedNotRelevant}`
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
      onCardsGenerated()
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось сгенерировать карточки",
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
