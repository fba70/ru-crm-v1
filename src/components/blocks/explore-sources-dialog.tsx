"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { MODELS, DEFAULT_MODEL_KEY } from "@/lib/llm-models"
import type { SourceSummary } from "@/server/sources"
import type { RuleRow } from "@/app/api/rules/route"

type Period = "last_day" | "last_3_days" | "last_week" | "specific"

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoNDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function resolveRange(
  period: Period,
  specificFrom: string,
  specificTo: string,
): { from: string; to: string } {
  if (period === "last_day") {
    return { from: isoNDaysAgo(1), to: todayIso() }
  }
  if (period === "last_3_days") {
    return { from: isoNDaysAgo(3), to: todayIso() }
  }
  if (period === "last_week") {
    return { from: isoNDaysAgo(7), to: todayIso() }
  }
  return { from: specificFrom, to: specificTo }
}

export function ExploreSourcesDialog({
  trigger,
  onCardsGenerated,
}: {
  trigger: React.ReactNode
  onCardsGenerated: () => void
}) {
  const [open, setOpen] = useState(false)

  const [period, setPeriod] = useState<Period>("last_week")
  const [specificFrom, setSpecificFrom] = useState(() => isoNDaysAgo(7))
  const [specificTo, setSpecificTo] = useState(() => todayIso())

  const [allSources, setAllSources] = useState(true)
  const [sources, setSources] = useState<SourceSummary[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    new Set(),
  )

  const [rules, setRules] = useState<RuleRow[]>([])
  const [ruleId, setRuleId] = useState<string>("")

  const [modelKey, setModelKey] = useState<string>(DEFAULT_MODEL_KEY)
  const [includeAlreadyAnalyzed, setIncludeAlreadyAnalyzed] = useState(false)

  const [loadingOptions, setLoadingOptions] = useState(false)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewCap, setPreviewCap] = useState<number>(50)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [running, setRunning] = useState(false)

  const range = useMemo(
    () => resolveRange(period, specificFrom, specificTo),
    [period, specificFrom, specificTo],
  )

  const effectiveSourceIds = useMemo(
    () => (allSources ? null : Array.from(selectedSourceIds)),
    [allSources, selectedSourceIds],
  )

  // Load sources + rules when the dialog opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingOptions(true)
    ;(async () => {
      try {
        const [sRes, rRes] = await Promise.all([
          fetch("/api/sources/options"),
          fetch("/api/rules?type=Custom"),
        ])
        const sData = await sRes.json()
        const rData = await rRes.json()
        if (cancelled) return
        const loadedSources: SourceSummary[] = sData.sources ?? []
        const loadedRules: RuleRow[] = rData.rules ?? []
        setSources(loadedSources)
        setRules(loadedRules)
        if (loadedRules.length > 0 && !ruleId) {
          setRuleId(loadedRules[0].id)
        }
      } catch {
        toast.error("Could not load sources or rules")
      } finally {
        if (!cancelled) setLoadingOptions(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, ruleId])

  // Preview count whenever the relevant filters change (debounced lightly).
  const fetchPreview = useCallback(async () => {
    if (!open) return
    setPreviewLoading(true)
    try {
      const params = new URLSearchParams()
      if (range.from) params.set("from", range.from)
      if (range.to) params.set("to", range.to)
      if (effectiveSourceIds && effectiveSourceIds.length > 0) {
        params.set("sourceIds", effectiveSourceIds.join(","))
      }
      if (includeAlreadyAnalyzed) params.set("includeAlreadyAnalyzed", "1")
      const res = await fetch(`/api/cards/generate?${params.toString()}`)
      if (!res.ok) {
        setPreviewCount(null)
        return
      }
      const data = await res.json()
      setPreviewCount(typeof data.count === "number" ? data.count : null)
      if (typeof data.cap === "number") setPreviewCap(data.cap)
    } catch {
      setPreviewCount(null)
    } finally {
      setPreviewLoading(false)
    }
  }, [open, range.from, range.to, effectiveSourceIds, includeAlreadyAnalyzed])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(fetchPreview, 200)
    return () => clearTimeout(t)
  }, [open, fetchPreview])

  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = async () => {
    if (!ruleId) {
      toast.error("Pick a rule first")
      return
    }
    if (!allSources && selectedSourceIds.size === 0) {
      toast.error("Pick at least one source or switch to All sources")
      return
    }
    if (period === "specific" && (!specificFrom || !specificTo)) {
      toast.error("Pick both From and To dates")
      return
    }

    setRunning(true)
    try {
      const res = await fetch("/api/cards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: range.from,
          to: range.to,
          sourceIds: effectiveSourceIds,
          ruleId,
          modelKey,
          includeAlreadyAnalyzed,
        }),
      })
      const data = await res.json()
      // Surface the full server response so the operator can inspect
      // per-item error messages in DevTools when something looks off.
      console.log("[explore-sources] server response:", data)
      if (!res.ok) {
        toast.error(data.error || "Card generation failed")
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
        console.warn("[explore-sources] per-item errors:", r.errors)
      }
      const summary = `${r.cardsCreated} card${
        r.cardsCreated === 1 ? "" : "s"
      } created · ${r.scanned} scanned · ${r.skippedNotRelevant} skipped`
      if (r.capped > 0) {
        toast.success(`${summary} (capped — ${r.capped} extra not analyzed)`, {
          duration: 8000,
        })
      } else if (r.failed > 0) {
        toast.warning(`${summary} · ${r.failed} failed`, { duration: 8000 })
      } else {
        toast.success(summary)
      }
      onCardsGenerated()
      setOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Card generation failed")
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Explore sources</DialogTitle>
          <DialogDescription>
            Run the chosen rule against source items in the selected window.
            Hard cap of {previewCap} items per click — re-run with a tighter
            window if you have more.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <section className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Time period
            </Label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { key: "last_day", label: "Last day" },
                  { key: "last_3_days", label: "Last 3 days" },
                  { key: "last_week", label: "Last week" },
                  { key: "specific", label: "Specific dates" },
                ] as const
              ).map((p) => (
                <Button
                  key={p.key}
                  type="button"
                  variant={period === p.key ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPeriod(p.key)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            {period === "specific" && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="explore-from" className="text-xs">
                    From
                  </Label>
                  <Input
                    id="explore-from"
                    type="date"
                    value={specificFrom}
                    onChange={(e) => setSpecificFrom(e.target.value)}
                    className="w-fit"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="explore-to" className="text-xs">
                    To
                  </Label>
                  <Input
                    id="explore-to"
                    type="date"
                    value={specificTo}
                    onChange={(e) => setSpecificTo(e.target.value)}
                    className="w-fit"
                  />
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Sources
            </Label>
            <div className="flex items-center gap-2">
              <Checkbox
                id="explore-all-sources"
                checked={allSources}
                onCheckedChange={(v) => setAllSources(v === true)}
              />
              <Label
                htmlFor="explore-all-sources"
                className="text-sm cursor-pointer"
              >
                All org sources
              </Label>
            </div>
            {!allSources && (
              <div className="rounded-md border p-2 max-h-40 overflow-y-auto space-y-1">
                {loadingOptions ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader className="h-3.5 w-3.5 animate-spin" />
                    Loading sources…
                  </div>
                ) : sources.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">
                    No sources configured for this org.
                  </div>
                ) : (
                  sources.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`explore-src-${s.id}`}
                        checked={selectedSourceIds.has(s.id)}
                        onCheckedChange={() => toggleSource(s.id)}
                      />
                      <Label
                        htmlFor={`explore-src-${s.id}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {s.name}{" "}
                        <span className="text-muted-foreground text-xs">
                          ({s.provider})
                        </span>
                      </Label>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <Label
              htmlFor="explore-rule"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Rule
            </Label>
            <Select value={ruleId} onValueChange={setRuleId}>
              <SelectTrigger id="explore-rule" className="w-full">
                <SelectValue
                  placeholder={
                    loadingOptions
                      ? "Loading rules…"
                      : rules.length === 0
                        ? "No org rules configured"
                        : "Pick a rule"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {rules.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rules.length === 0 && !loadingOptions && (
              <p className="text-xs text-muted-foreground">
                Create a Custom rule on the Rules page first.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <Label
              htmlFor="explore-model"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Model
            </Label>
            <Select value={modelKey} onValueChange={setModelKey}>
              <SelectTrigger id="explore-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="space-y-2">
            <div className="flex items-start gap-2">
              <Checkbox
                id="explore-include-already"
                checked={includeAlreadyAnalyzed}
                onCheckedChange={(v) =>
                  setIncludeAlreadyAnalyzed(v === true)
                }
                className="mt-0.5"
              />
              <Label
                htmlFor="explore-include-already"
                className="text-sm cursor-pointer leading-snug"
              >
                Re-analyze items already processed by a previous run
                <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                  By default, items the pipeline has already considered are
                  skipped. Tick this for ad-hoc re-runs.
                </span>
              </Label>
            </div>
          </section>

          <section className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              {previewLoading ? (
                <span className="text-muted-foreground">
                  Counting eligible items…
                </span>
              ) : previewCount === null ? (
                <span className="text-muted-foreground">
                  Pick a window to see how many items will be analyzed.
                </span>
              ) : (
                <span>
                  <strong>{Math.min(previewCount, previewCap)}</strong> item
                  {previewCount === 1 ? "" : "s"} will be analyzed
                  {previewCount > previewCap && (
                    <>
                      {" "}
                      <span className="text-muted-foreground">
                        ({previewCount - previewCap} more outside the cap)
                      </span>
                    </>
                  )}
                  .
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Only items that have been parsed and uploaded to R2 are
              eligible.
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={running}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              running ||
              !ruleId ||
              previewCount === 0 ||
              (period === "specific" && (!specificFrom || !specificTo))
            }
          >
            {running ? (
              <>
                <Loader className="h-4 w-4 mr-1 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1" />
                Run analysis
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
