"use client"

// Batch "Обогатить клиентов" toolbar control + manual-review dialog.
// Browser-driven loop (see refs/enrich-clients.md): fetches the pending-client
// id list, then POSTs ONE short request per client so no single request can
// time out. Processing is deliberately **one-by-one** (sequential, with a 4s
// gap between clients) — safe for the free AI-gateway tier; there are no
// speed options. Each client is committed server-side as it finishes, so a
// cancel / closed tab / crash loses nothing already done: re-running picks up
// exactly the remainder (the worklist is "enrichment_status IS NULL").

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Sparkles, Loader, X, ExternalLink, ClipboardCheck } from "lucide-react"
import type { EnrichReviewRow } from "@/app/api/clients/enrich/review/route"
import type { EnrichClientResult } from "@/app/api/clients/[id]/enrich/route"

type Confidence = "high" | "medium" | "low"

const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  medium: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  low: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
}
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
}

// Russian plural picker: forms = [one, few, many].
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

const COUNT_POLL_MS = 30_000
const PER_CLIENT_TIMEOUT_MS = 75_000 // client-side backstop (dev ignores maxDuration)
const INTER_CLIENT_DELAY_MS = 4_000 // free-tier pacing — one client at a time
const BATCH_LIMIT = 200

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type Progress = { done: number; total: number; failed: number }

export function ClientEnrichControl({
  refreshKey,
  onChanged,
}: {
  refreshKey: number
  onChanged: () => void
}) {
  const [pendingTotal, setPendingTotal] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [cancelRequested, setCancelRequested] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const cancelRef = useRef(false)

  const pollCounts = useCallback(async () => {
    try {
      const [pendingRes, reviewRes] = await Promise.all([
        fetch("/api/clients/enrich/pending?limit=1"),
        fetch("/api/clients/enrich/review"),
      ])
      if (pendingRes.ok) {
        const d = await pendingRes.json()
        setPendingTotal(d.total ?? 0)
      }
      if (reviewRes.ok) {
        const d = await reviewRes.json()
        setReviewCount((d.rows ?? []).length)
      }
    } catch {
      // Counts are informational — stay silent on transient failures.
    }
  }, [])

  // Poll on mount + every 30s (paused while running) + on refreshKey change.
  useEffect(() => {
    if (running) return
    pollCounts()
    const t = setInterval(pollCounts, COUNT_POLL_MS)
    return () => clearInterval(t)
  }, [pollCounts, running, refreshKey])

  const runBatch = useCallback(async () => {
    let ids: string[] = []
    let total = 0
    try {
      const res = await fetch(`/api/clients/enrich/pending?limit=${BATCH_LIMIT}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Не удалось получить список")
      ids = data.ids ?? []
      total = data.total ?? ids.length
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети")
      return
    }
    if (ids.length === 0) {
      toast("Нечего обогащать")
      void pollCounts()
      return
    }

    cancelRef.current = false
    setCancelRequested(false)
    setRunning(true)
    setProgress({ done: 0, total: ids.length, failed: 0 })

    const tally = { enriched: 0, review: 0, no_match: 0, skipped: 0, failed: 0 }
    const failures: string[] = []

    for (let i = 0; i < ids.length; i++) {
      if (cancelRef.current) break
      const id = ids[i]
      try {
        const res = await fetch(`/api/clients/${id}/enrich`, {
          method: "POST",
          signal: AbortSignal.timeout(PER_CLIENT_TIMEOUT_MS),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          tally.failed++
          failures.push(d.error ?? `Клиент ${id}`)
        } else {
          const out = (await res.json()) as EnrichClientResult
          tally[out.outcome]++
        }
      } catch {
        // Non-OK / timeout / abort → failed. The row stays NULL server-side,
        // so the next run retries only it.
        tally.failed++
        failures.push(`Клиент ${id}`)
      }

      setProgress({
        done: i + 1,
        total: ids.length,
        failed: tally.failed,
      })
      // One-by-one: refresh the list + re-poll counts after each client.
      onChanged()
      void pollCounts()

      // Free-tier pacing — wait between clients (skip after the last / on cancel).
      if (i < ids.length - 1 && !cancelRef.current) {
        await sleep(INTER_CLIENT_DELAY_MS)
      }
    }

    setRunning(false)
    setProgress(null)
    setCancelRequested(false)

    toast.success(
      `${tally.enriched} обогащено · ${tally.review} на проверке · ` +
        `${tally.no_match} без совпадений · ${tally.failed} ошибок`,
    )
    if (!cancelRef.current && total > ids.length) {
      const more = total - ids.length
      toast(
        `Ещё ${more} ${plural(more, ["клиент", "клиента", "клиентов"])} в очереди — запустите снова`,
      )
    }
    const shown = failures.slice(0, 8)
    for (const f of shown) toast.error(f)
    if (failures.length > shown.length) {
      toast.error(`…и ещё ${failures.length - shown.length}`)
    }
    void pollCounts()
  }, [onChanged, pollCounts])

  function requestCancel() {
    cancelRef.current = true
    setCancelRequested(true)
  }

  return (
    <>
      {running && progress ? (
        <div className="inline-flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-xs">
          <Loader className="h-3.5 w-3.5 animate-spin shrink-0" />
          <span className="whitespace-nowrap">
            Обогащение — {progress.done} / {progress.total}
            {progress.failed > 0 && (
              <span className="text-destructive ml-1">
                · ошибок {progress.failed}
              </span>
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs shrink-0"
            onClick={requestCancel}
            disabled={cancelRequested}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            {cancelRequested ? "Отмена…" : "Отменить"}
          </Button>
        </div>
      ) : (
        pendingTotal > 0 && (
          <Button size="sm" variant="default" onClick={runBatch}>
            <Sparkles className="h-4 w-4 mr-1" />
            Обогатить клиентскую информацию ({pendingTotal})
          </Button>
        )
      )}

      {reviewCount > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setReviewOpen(true)}
          disabled={running}
        >
          <ClipboardCheck className="h-4 w-4 mr-1" />
          На проверке ({reviewCount})
        </Button>
      )}

      <EnrichReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        onChanged={() => {
          onChanged()
          void pollCounts()
        }}
      />
    </>
  )
}

// ── Manual disambiguation dialog (Phase B) ───────────────────────────
// Replays the candidates parked during the batch — no new web calls.

function EnrichReviewDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  onChanged: () => void
}) {
  const [rows, setRows] = useState<EnrichReviewRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/clients/enrich/review")
      const data = await res.json()
      if (res.ok) setRows(data.rows ?? [])
    } catch {
      toast.error("Не удалось загрузить список на проверку")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function resolve(
    clientId: string,
    choice: { candidateIndex: number } | { skip: true },
  ) {
    setBusyId(clientId)
    try {
      const res = await fetch(`/api/clients/${clientId}/enrich/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось сохранить выбор")
        return
      }
      toast.success("skip" in choice ? "Клиент пропущен" : "Данные применены")
      setRows((prev) => prev.filter((r) => r.id !== clientId))
      onChanged()
    } catch {
      toast.error("Ошибка сети")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Проверка обогащения клиентов</DialogTitle>
          <DialogDescription>
            Для этих клиентов поиск нашёл несколько подходящих компаний. Выберите
            верную карточку, чтобы заполнить пустые поля, или пропустите клиента.
            Уже заполненные вами поля не перезаписываются.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader className="h-4 w-4 animate-spin" />
              Загрузка…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Нет клиентов на проверке.
            </p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{row.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => resolve(row.id, { skip: true })}
                    disabled={busyId === row.id}
                  >
                    Пропустить
                  </Button>
                </div>
                <div className="space-y-2">
                  {row.candidates.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      className="w-full text-left rounded-md border p-3 hover:bg-muted/40 hover:border-primary/40 transition-colors space-y-1 disabled:opacity-50"
                      onClick={() => resolve(row.id, { candidateIndex: i })}
                      disabled={busyId === row.id}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{c.name}</span>
                        <Badge
                          variant="secondary"
                          className={CONFIDENCE_COLOR[c.confidence]}
                        >
                          {CONFIDENCE_LABEL[c.confidence]}
                        </Badge>
                      </div>
                      {c.address && (
                        <div className="text-xs text-muted-foreground">
                          {c.address}
                        </div>
                      )}
                      {(c.email || c.phone) && (
                        <div className="text-xs text-muted-foreground">
                          {[c.email, c.phone].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {c.webUrl && (
                        <span className="text-xs text-blue-600 dark:text-blue-400 inline-flex items-center gap-1">
                          {c.webUrl}
                          <ExternalLink className="h-3 w-3" />
                        </span>
                      )}
                      {c.whyMatch && (
                        <div className="text-xs italic text-muted-foreground">
                          {c.whyMatch}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
