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
import type {
  GenerateDealsResult,
  PlannedDealAction,
} from "@/app/api/deals/discover/route"

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
  if (period === "last_day") return { from: isoNDaysAgo(1), to: todayIso() }
  if (period === "last_3_days") return { from: isoNDaysAgo(3), to: todayIso() }
  if (period === "last_week") return { from: isoNDaysAgo(7), to: todayIso() }
  return { from: specificFrom, to: specificTo }
}

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

export function DiscoverDealsDialog({
  trigger,
  onDealsGenerated,
}: {
  trigger: React.ReactNode
  onDealsGenerated: () => void
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
  // Dry run: preview what the rule WOULD do, writing nothing. The rule-testing
  // loop — iterate wording, re-run, no duplicates created, no items stamped.
  const [dryRun, setDryRun] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<GenerateDealsResult | null>(
    null,
  )

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

  // Load sources + rules on open. Rules are scoped to Custom — same as the
  // Cards explore dialog. Operators write a deal-extraction rule on the
  // Rules page and pick it here.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingOptions(true)
    ;(async () => {
      try {
        const [sRes, rRes] = await Promise.all([
          fetch("/api/sources/options"),
          fetch("/api/rules?type=Custom&activeOrgOnly=1"),
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
        toast.error("Не удалось загрузить источники или правила")
      } finally {
        if (!cancelled) setLoadingOptions(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, ruleId])

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
      const res = await fetch(`/api/deals/discover?${params.toString()}`)
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
    // A stale dry-run preview no longer reflects the current inputs.
    setDryRunResult(null)
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
      toast.error("Сначала выберите правило")
      return
    }
    if (!allSources && selectedSourceIds.size === 0) {
      toast.error("Выберите хотя бы один источник или переключитесь на «Все источники»")
      return
    }
    if (period === "specific" && (!specificFrom || !specificTo)) {
      toast.error("Укажите обе даты — «С» и «По»")
      return
    }

    setRunning(true)
    setDryRunResult(null)
    try {
      const res = await fetch("/api/deals/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: range.from,
          to: range.to,
          sourceIds: effectiveSourceIds,
          ruleId,
          modelKey,
          includeAlreadyAnalyzed,
          dryRun,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Не удалось выполнить поиск сделок")
        return
      }
      const r = data.result as GenerateDealsResult
      if (r.errors && r.errors.length > 0) {
        console.warn("[discover-deals] per-item errors:", r.errors)
      }
      const skippedTotal =
        r.skippedNotRelevant +
        r.skippedNoMarkdown +
        r.skippedUnknownClient +
        r.skippedUnknownStage +
        r.skippedUnknownDeal +
        r.skippedDuplicate

      // Dry run: keep the dialog open and render the planned actions so the
      // operator can judge the rule. Nothing was written, so don't refresh
      // the board.
      if (r.dryRun) {
        setDryRunResult(r)
        const verb = `создано бы ${r.dealsCreated} · перемещено бы ${r.stageUpdates}`
        toast.success(`Пробный запуск · ${verb} · просмотрено ${r.scanned}`)
        return
      }

      const summary =
        `Создано ${r.dealsCreated} · обновлений этапа ${r.stageUpdates} · ` +
        `просмотрено ${r.scanned} · пропущено ${skippedTotal}`
      if (r.capped > 0) {
        toast.success(
          `${summary} (достигнут предел — ${r.capped} не проанализировано)`,
          {
            duration: 8000,
          },
        )
      } else if (r.failed > 0) {
        toast.warning(`${summary} · ошибок: ${r.failed}`, { duration: 8000 })
      } else {
        toast.success(summary)
      }
      onDealsGenerated()
      setOpen(false)
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось выполнить поиск сделок",
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Найти сделки в источниках</DialogTitle>
          <DialogDescription>
            Запустите выбранное правило по элементам источников за указанный
            период. Модель может создавать новые сделки или переводить открытые
            сделки на другой этап воронки. Не более {previewCap} элементов за
            один запуск.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <section className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Период
            </Label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { key: "last_day", label: "За день" },
                  { key: "last_3_days", label: "За 3 дня" },
                  { key: "last_week", label: "За неделю" },
                  { key: "specific", label: "Указать даты" },
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
                  <Label htmlFor="discover-deals-from" className="text-xs">
                    С
                  </Label>
                  <Input
                    id="discover-deals-from"
                    type="date"
                    value={specificFrom}
                    onChange={(e) => setSpecificFrom(e.target.value)}
                    className="w-fit"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="discover-deals-to" className="text-xs">
                    По
                  </Label>
                  <Input
                    id="discover-deals-to"
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
              Источники
            </Label>
            <div className="flex items-center gap-2">
              <Checkbox
                id="discover-deals-all-sources"
                checked={allSources}
                onCheckedChange={(v) => setAllSources(v === true)}
              />
              <Label
                htmlFor="discover-deals-all-sources"
                className="text-sm cursor-pointer"
              >
                Все источники организации
              </Label>
            </div>
            {!allSources && (
              <div className="rounded-md border p-2 max-h-40 overflow-y-auto space-y-1">
                {loadingOptions ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader className="h-3.5 w-3.5 animate-spin" />
                    Загрузка источников…
                  </div>
                ) : sources.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">
                    Для организации не настроены источники.
                  </div>
                ) : (
                  sources.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`discover-deals-src-${s.id}`}
                        checked={selectedSourceIds.has(s.id)}
                        onCheckedChange={() => toggleSource(s.id)}
                      />
                      <Label
                        htmlFor={`discover-deals-src-${s.id}`}
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
              htmlFor="discover-deals-rule"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Правило
            </Label>
            <Select value={ruleId} onValueChange={setRuleId}>
              <SelectTrigger id="discover-deals-rule" className="w-full">
                <SelectValue
                  placeholder={
                    loadingOptions
                      ? "Загрузка правил…"
                      : rules.length === 0
                        ? "Нет настроенных правил"
                        : "Выберите правило"
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
              <p className="text-xs rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                В организации нет пользовательских правил извлечения сделок.
                Сначала создайте его на странице{" "}
                <a href="/rules" className="underline font-medium">
                  «Правила»
                </a>
                .
              </p>
            )}
          </section>

          <section className="space-y-2">
            <Label
              htmlFor="discover-deals-model"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Модель
            </Label>
            <Select value={modelKey} onValueChange={setModelKey}>
              <SelectTrigger id="discover-deals-model" className="w-full">
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
                id="discover-deals-include-already"
                checked={includeAlreadyAnalyzed}
                onCheckedChange={(v) =>
                  setIncludeAlreadyAnalyzed(v === true)
                }
                className="mt-0.5"
              />
              <Label
                htmlFor="discover-deals-include-already"
                className="text-sm cursor-pointer leading-snug"
              >
                Повторно проанализировать элементы, уже обработанные ранее
                <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                  По умолчанию уже обработанные элементы пропускаются. Отметьте
                  для повторного запуска вручную.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="discover-deals-dry-run"
                checked={dryRun}
                onCheckedChange={(v) => setDryRun(v === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="discover-deals-dry-run"
                className="text-sm cursor-pointer leading-snug"
              >
                Пробный запуск (только предпросмотр — ничего не записывается)
                <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                  Запускает правило и показывает, что будет создано / перемещено,
                  не затрагивая сделки и не помечая элементы. Используйте для
                  доработки формулировок правила перед применением.
                </span>
              </Label>
            </div>
          </section>

          {dryRunResult && (
            <section className="rounded-md border border-dashed border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  Предпросмотр пробного запуска — ничего не записано
                </span>
                <span className="text-xs text-muted-foreground">
                  просмотрено {dryRunResult.scanned}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                создано бы {dryRunResult.dealsCreated} ·{" "}
                перемещено бы {dryRunResult.stageUpdates} ·{" "}
                дубликатов {dryRunResult.skippedDuplicate} ·{" "}
                нерелевантно {dryRunResult.skippedNotRelevant} ·{" "}
                не сопоставлено{" "}
                {dryRunResult.skippedUnknownClient +
                  dryRunResult.skippedUnknownStage +
                  dryRunResult.skippedUnknownDeal}
                {dryRunResult.failed > 0
                  ? ` · ошибок ${dryRunResult.failed}`
                  : ""}
              </div>
              {dryRunResult.plannedActions.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">
                  Нет действий создания / перемещения — правило пропустило всё
                  за этот период.
                </div>
              ) : (
                <ul className="max-h-52 overflow-y-auto space-y-1.5 text-xs">
                  {dryRunResult.plannedActions.map(
                    (a: PlannedDealAction, i: number) => (
                      <li
                        key={`${a.sourceItemId}-${i}`}
                        className="rounded border bg-background/60 px-2 py-1.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${
                              a.action === "CREATE"
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                                : "bg-blue-500/15 text-blue-600 dark:text-blue-300"
                            }`}
                          >
                            {a.action === "CREATE" ? "СОЗДАТЬ" : "ПЕРЕМЕСТИТЬ"}
                          </span>
                          <span className="font-medium truncate">
                            {a.dealName}
                          </span>
                          {a.stageName && (
                            <span className="text-muted-foreground truncate">
                              → {a.stageName}
                            </span>
                          )}
                          {a.clientName && (
                            <span className="text-muted-foreground truncate">
                              · {a.clientName}
                            </span>
                          )}
                        </div>
                        {a.reasoning && (
                          <div className="text-muted-foreground mt-0.5 line-clamp-2">
                            {a.reasoning}
                          </div>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Снимите «Пробный запуск» и запустите снова, чтобы применить.
              </p>
            </section>
          )}

          <section className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              {previewLoading ? (
                <span className="text-muted-foreground">
                  Подсчёт подходящих элементов…
                </span>
              ) : previewCount === null ? (
                <span className="text-muted-foreground">
                  Выберите период, чтобы увидеть, сколько элементов будет
                  проанализировано.
                </span>
              ) : (
                <span>
                  Будет проанализировано{" "}
                  <strong>{Math.min(previewCount, previewCap)}</strong>{" "}
                  {plural(Math.min(previewCount, previewCap), [
                    "элемент",
                    "элемента",
                    "элементов",
                  ])}
                  {previewCount > previewCap && (
                    <>
                      {" "}
                      <span className="text-muted-foreground">
                        (ещё {previewCount - previewCap} сверх предела)
                      </span>
                    </>
                  )}
                  .
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Подходят только элементы, которые разобраны и загружены в R2.
              Элементы старше контрольной даты (5 мая 2026) были помечены
              заранее и не появятся здесь без повторного разбора.
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={running}
          >
            Отмена
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
                Анализ…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1" />
                {dryRun ? "Предпросмотр (пробный запуск)" : "Запустить поиск"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
