"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader,
  XCircle,
} from "lucide-react"

const PAGE_SIZE = 10

// Shape mirrors `PipelineStats` returned by /api/admin/pipeline/stats —
// kept inline so this file has no server-side import dependency.
type PipelineStats = {
  totals: {
    itemsFetched: number
    itemsProcessed: number
    itemsWithErrors: number
    itemsSkipped: number
    parseCapped: number
    runCount: number
  }
  runs: {
    id: string
    startedAt: string
    finishedAt: string | null
    trigger: "cron" | "manual"
    status: "running" | "success" | "failed"
    durationMs: number | null
    syncItemsInserted: number
    parseComplete: number
    uploadSucceeded: number
    parseFailed: number
    uploadFailed: number
    parseSkipped: number
    parseCapped: number
  }[]
  errors: {
    pipelineRunId: string
    runStartedAt: string
    runTrigger: "cron" | "manual"
    phase: "sync" | "parse" | "upload"
    sourceId?: string
    sourceItemId?: string
    message: string
  }[]
}

// ── Date helpers ────────────────────────────────────────────────────
// All filters operate in UTC because the cron schedule is UTC. Picking
// "Today" in Central Europe at 02:00 should resolve to the same window
// as picking it in Tokyo at 10:00 — otherwise the most recent 03:00 UTC
// run looks like it's from "yesterday" half the time.

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function shiftDays(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function dateInputToStartOfDay(d: string): string {
  return new Date(`${d}T00:00:00.000Z`).toISOString()
}

function dateInputToEndOfDay(d: string): string {
  return new Date(`${d}T23:59:59.999Z`).toISOString()
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

// ── Component ────────────────────────────────────────────────────────

export function WorkflowStatistics() {
  // Default = today UTC. Captures the night's cron run + any manual
  // runs the admin triggered earlier in the day. Same value for both
  // ends of the range collapses to a 24-hour window when the API
  // expands them via dateInputToStartOfDay / dateInputToEndOfDay.
  const [from, setFrom] = useState<string>(todayUtcDateString)
  const [to, setTo] = useState<string>(todayUtcDateString)
  const [data, setData] = useState<PipelineStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorPage, setErrorPage] = useState(1)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        from: dateInputToStartOfDay(from),
        to: dateInputToEndOfDay(to),
      })
      const res = await fetch(`/api/admin/pipeline/stats?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || "Failed to load stats")
      setData(body as PipelineStats)
      setErrorPage(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  function setRange(fromOffsetDays: number, toOffsetDays: number) {
    setFrom(shiftDays(fromOffsetDays))
    setTo(shiftDays(toOffsetDays))
  }

  const errorPages = data
    ? Math.max(1, Math.ceil(data.errors.length / PAGE_SIZE))
    : 1
  const errorPageRows = data
    ? data.errors.slice((errorPage - 1) * PAGE_SIZE, errorPage * PAGE_SIZE)
    : []

  const mostRecentRun = data?.runs[0] ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workflow Statistics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filter row */}
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              From (UTC)
            </label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              To (UTC)
            </label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setRange(0, 0)}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setRange(-1, -1)}
          >
            Yesterday
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setRange(-6, 0)}
          >
            Last 7 days
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setRange(-29, 0)}
          >
            Last 30 days
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {data && !loading && (
          <>
            {/* Metric tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <MetricTile
                label="Items newly fetched"
                value={data.totals.itemsFetched}
              />
              <MetricTile
                label="Items fully processed"
                value={data.totals.itemsProcessed}
                tone="green"
              />
              <MetricTile
                label="Items with errors"
                value={data.totals.itemsWithErrors}
                tone={data.totals.itemsWithErrors > 0 ? "red" : "default"}
              />
            </div>

            {/* Sub-stats: deterministic non-error outcomes */}
            {(data.totals.itemsSkipped > 0 || data.totals.parseCapped > 0) && (
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4">
                {data.totals.itemsSkipped > 0 && (
                  <span>
                    {data.totals.itemsSkipped} skipped (deleted at provider /
                    unsupported / oversize)
                  </span>
                )}
                {data.totals.parseCapped > 0 && (
                  <span>
                    {data.totals.parseCapped} deferred to next run (cap reached)
                  </span>
                )}
              </div>
            )}

            {/* Runs in range */}
            <div className="border-t pt-3 space-y-2">
              {data.runs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No pipeline runs in this range.
                </p>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground">
                    {data.runs.length} run
                    {data.runs.length !== 1 ? "s" : ""} in this range
                    {mostRecentRun && (
                      <>
                        {" — most recent: "}
                        {formatDateTime(mostRecentRun.startedAt)}
                      </>
                    )}
                  </div>
                  <div className="rounded-md border overflow-hidden">
                    <Table className="table-fixed w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-32">Started</TableHead>
                          <TableHead className="w-20">Trigger</TableHead>
                          <TableHead className="w-24">Status</TableHead>
                          <TableHead className="w-24">Duration</TableHead>
                          <TableHead>Counts</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.runs.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {formatDateTime(r.startedAt)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {r.trigger}
                            </TableCell>
                            <TableCell>
                              <RunStatusBadge status={r.status} />
                            </TableCell>
                            <TableCell className="text-xs">
                              {formatDuration(r.durationMs)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {r.syncItemsInserted} fetched ·{" "}
                              {r.uploadSucceeded} processed
                              {r.parseFailed + r.uploadFailed > 0 && (
                                <span className="text-red-700 dark:text-red-300">
                                  {" "}
                                  · {r.parseFailed + r.uploadFailed} errors
                                </span>
                              )}
                              {r.parseCapped > 0 && (
                                <span> · {r.parseCapped} deferred</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>

            {/* Errors table */}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Errors {data.errors.length > 0 && `(${data.errors.length})`}
              </div>
              <div className="rounded-md border overflow-hidden">
                <Table className="table-fixed w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">When</TableHead>
                      <TableHead className="w-20">Trigger</TableHead>
                      <TableHead className="w-20">Phase</TableHead>
                      <TableHead className="w-80">Source / Item</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {errorPageRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-sm text-muted-foreground py-6"
                        >
                          No errors recorded in this range.
                        </TableCell>
                      </TableRow>
                    ) : (
                      errorPageRows.map((e, i) => (
                        <TableRow key={`${e.pipelineRunId}-${i}`}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {formatDateTime(e.runStartedAt)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {e.runTrigger}
                          </TableCell>
                          <TableCell className="text-xs">{e.phase}</TableCell>
                          <TableCell className="text-xs font-mono">
                            {e.sourceItemId ?? e.sourceId ? (
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className="truncate"
                                  title={e.sourceItemId ?? e.sourceId ?? ""}
                                >
                                  {e.sourceItemId ?? e.sourceId}
                                </span>
                                <CopyIdButton
                                  id={(e.sourceItemId ?? e.sourceId) as string}
                                />
                              </div>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell
                            className="text-xs truncate"
                            title={e.message}
                          >
                            {e.message}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {data.errors.length > PAGE_SIZE && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    Page {errorPage} of {errorPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={errorPage <= 1}
                      onClick={() => setErrorPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={errorPage >= errorPages}
                      onClick={() =>
                        setErrorPage((p) => Math.min(errorPages, p + 1))
                      }
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function MetricTile({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: number
  tone?: "default" | "green" | "red"
}) {
  const palette: Record<typeof tone, string> = {
    default: "bg-muted/50",
    green:
      "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    red: "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200",
  }
  return (
    <div className={`rounded-md border p-4 ${palette[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-70 mb-1">
        {label}
      </div>
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
    </div>
  )
}

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(id)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className="opacity-50 hover:opacity-100 transition-opacity shrink-0"
      title="Copy ID"
      aria-label="Copy ID"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-600" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  )
}

function RunStatusBadge({
  status,
}: {
  status: "running" | "success" | "failed"
}) {
  if (status === "success") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        success
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-300">
        <XCircle className="h-3.5 w-3.5" />
        failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300">
      <Loader className="h-3.5 w-3.5 animate-spin" />
      running
    </span>
  )
}
