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

  const [period, setPeriod] = useState<Period>("last_day")
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
        console.warn("[explore-sources] per-item errors:", r.errors)
      }
      const summary = `Создано ${r.cardsCreated} ${plural(r.cardsCreated, [
        "карточка",
        "карточки",
        "карточек",
      ])} · просмотрено ${r.scanned} · пропущено ${r.skippedNotRelevant}`
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
      onCardsGenerated()
      setOpen(false)
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось сгенерировать карточки",
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
          <DialogTitle>Исследовать источники</DialogTitle>
          <DialogDescription>
            Запустите выбранное правило по элементам источников за указанный
            период. Не более {previewCap} элементов за один запуск — при
            необходимости сузьте период и повторите.
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
                  <Label htmlFor="explore-from" className="text-xs">
                    С
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
                    По
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
              Источники
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
              Правило
            </Label>
            <Select value={ruleId} onValueChange={setRuleId}>
              <SelectTrigger id="explore-rule" className="w-full">
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
                В организации нет пользовательских правил. Сначала создайте его
                на странице{" "}
                <a href="/rules" className="underline font-medium">
                  «Правила»
                </a>
                .
              </p>
            )}
          </section>

          <section className="space-y-2">
            <Label
              htmlFor="explore-model"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Модель
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
                Повторно проанализировать элементы, уже обработанные ранее
                <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                  По умолчанию уже обработанные элементы пропускаются. Отметьте
                  для повторного запуска вручную.
                </span>
              </Label>
            </div>
          </section>

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
                Запустить анализ
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
