"use client"

import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
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
import { Loader, Sparkles } from "lucide-react"
import type { DiscoveredCompany, DiscoveryPreview } from "@/app/api/clients/discover/route"
import type { ApplyDiscoveryResult } from "@/app/api/clients/discover/apply/route"

type Phase = "idle" | "scanning" | "preview" | "applying"

export function DiscoverClientsDialog({
  trigger,
  onApplied,
}: {
  trigger: React.ReactNode
  /** Called after a successful apply so the parent can refresh its list. */
  onApplied: () => void
}) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [preview, setPreview] = useState<DiscoveryPreview | null>(null)
  // Map normalisedKey → checked. Defaults to all-checked at preview load.
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState("")

  const reset = useCallback(() => {
    setPhase("idle")
    setPreview(null)
    setChecked({})
    setFilter("")
  }, [])

  const startScan = useCallback(async () => {
    setPhase("scanning")
    try {
      const res = await fetch("/api/clients/discover", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to scan")
      const p = data as DiscoveryPreview
      setPreview(p)
      const initial: Record<string, boolean> = {}
      for (const c of p.candidates) initial[c.normalisedKey] = true
      setChecked(initial)
      setPhase("preview")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to scan")
      setPhase("idle")
    }
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) {
        // Each open re-runs the scan — fresh data, no stale cache.
        startScan()
      } else {
        reset()
      }
    },
    [startScan, reset],
  )

  const filtered = useMemo(() => {
    if (!preview) return []
    const q = filter.trim().toLowerCase()
    if (!q) return preview.candidates
    return preview.candidates.filter((c) =>
      c.displayName.toLowerCase().includes(q),
    )
  }, [preview, filter])

  const selectedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked],
  )

  const allFilteredChecked = useMemo(
    () => filtered.length > 0 && filtered.every((c) => checked[c.normalisedKey]),
    [filtered, checked],
  )

  const toggleAllFiltered = useCallback(
    (next: boolean) => {
      setChecked((prev) => {
        const out = { ...prev }
        for (const c of filtered) out[c.normalisedKey] = next
        return out
      })
    },
    [filtered],
  )

  const apply = useCallback(
    async (selectedKeys: string[]) => {
      if (!preview) return
      setPhase("applying")
      try {
        const res = await fetch("/api/clients/discover/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selectedKeys,
            candidates: preview.candidates,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to apply")
        const result = data as ApplyDiscoveryResult
        if (result.createdCount > 0) {
          toast.success(
            `Created ${result.createdCount} client${result.createdCount === 1 ? "" : "s"}` +
              ` · marked ${result.scannedRowsStamped} source items as reviewed`,
          )
        } else {
          toast.success(
            `No clients created · marked ${result.scannedRowsStamped} source items as reviewed`,
          )
        }
        onApplied()
        setOpen(false)
        reset()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to apply")
        setPhase("preview")
      }
    },
    [preview, onApplied, reset],
  )

  const applySelected = useCallback(() => {
    const keys = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([k]) => k)
    apply(keys)
  }, [checked, apply])

  const dismissAll = useCallback(() => {
    apply([])
  }, [apply])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Discover clients from sources
          </DialogTitle>
          <DialogDescription>
            Scans companies extracted from your parsed sources, dedups against
            existing clients, and lets you create the new ones in bulk.
            Selected companies become clients with status{" "}
            <code className="text-xs bg-muted px-1 rounded">initial</code> for
            review. Source items contributing to this preview are marked as
            reviewed and won&apos;t be re-scanned unless re-parsed.
          </DialogDescription>
        </DialogHeader>

        {phase === "scanning" && (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">
              Scanning source items…
            </span>
          </div>
        )}

        {phase === "preview" && preview && (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground border-b pb-2">
              <span>
                Scanned {preview.scannedRowCount} new/re-parsed source items ·
                Found {preview.candidates.length} new compan
                {preview.candidates.length === 1 ? "y" : "ies"} · {selectedCount}{" "}
                selected
              </span>
            </div>

            {preview.candidates.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-12 text-sm text-muted-foreground">
                No new companies found. All extracted names already match
                existing clients (or there&apos;s nothing new to scan).
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Filter by name…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="flex-1"
                  />
                  <div className="flex items-center gap-2 px-2">
                    <Checkbox
                      id="discover-toggle-all"
                      checked={allFilteredChecked}
                      onCheckedChange={(v) => toggleAllFiltered(v === true)}
                    />
                    <label
                      htmlFor="discover-toggle-all"
                      className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap"
                    >
                      Toggle visible
                    </label>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto -mx-2 px-2 border rounded-md">
                  {filtered.map((c) => (
                    <CompanyRow
                      key={c.normalisedKey}
                      company={c}
                      checked={!!checked[c.normalisedKey]}
                      onToggle={(v) =>
                        setChecked((prev) => ({ ...prev, [c.normalisedKey]: v }))
                      }
                    />
                  ))}
                  {filtered.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-6">
                      No companies match the filter.
                    </div>
                  )}
                </div>
              </>
            )}

            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              {preview.candidates.length > 0 && (
                <Button variant="outline" onClick={dismissAll}>
                  Mark all reviewed
                </Button>
              )}
              <Button onClick={applySelected} disabled={selectedCount === 0}>
                Create {selectedCount} client{selectedCount === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === "applying" && (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">
              Creating clients…
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CompanyRow({
  company,
  checked,
  onToggle,
}: {
  company: DiscoveredCompany
  checked: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <label className="flex items-center gap-3 py-2 px-1 border-b last:border-b-0 cursor-pointer hover:bg-muted/40">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onToggle(v === true)}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{company.displayName}</div>
        <div className="text-xs text-muted-foreground">
          Mentioned in {company.occurrences} source item
          {company.occurrences === 1 ? "" : "s"}
        </div>
      </div>
    </label>
  )
}
