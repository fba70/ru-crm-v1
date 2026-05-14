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
import type {
  ContactDiscoveryPreview,
  DiscoveredContact,
} from "@/app/api/contacts/discover/route"
import type { ApplyContactDiscoveryResult } from "@/app/api/contacts/discover/apply/route"

type Phase = "idle" | "scanning" | "preview" | "applying"

export function DiscoverContactsDialog({
  trigger,
  onApplied,
}: {
  trigger: React.ReactNode
  /** Called after a successful apply so the parent can refresh its list. */
  onApplied: () => void
}) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [preview, setPreview] = useState<ContactDiscoveryPreview | null>(null)
  // Map email → checked. Defaults to all-checked at preview load.
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  // Map email → user-overridden display name (lets the user rename a
  // candidate before saving, useful when the discovered name is empty
  // or wrong).
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState("")

  const reset = useCallback(() => {
    setPhase("idle")
    setPreview(null)
    setChecked({})
    setNameOverrides({})
    setFilter("")
  }, [])

  const startScan = useCallback(async () => {
    setPhase("scanning")
    try {
      const res = await fetch("/api/contacts/discover", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to scan")
      const p = data as ContactDiscoveryPreview
      setPreview(p)
      const initial: Record<string, boolean> = {}
      for (const c of p.candidates) initial[c.email] = true
      setChecked(initial)
      setNameOverrides({})
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
    return preview.candidates.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q),
    )
  }, [preview, filter])

  const selectedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked],
  )

  const allFilteredChecked = useMemo(
    () => filtered.length > 0 && filtered.every((c) => checked[c.email]),
    [filtered, checked],
  )

  const toggleAllFiltered = useCallback(
    (next: boolean) => {
      setChecked((prev) => {
        const out = { ...prev }
        for (const c of filtered) out[c.email] = next
        return out
      })
    },
    [filtered],
  )

  const apply = useCallback(
    async (selectedEmails: string[]) => {
      if (!preview) return
      setPhase("applying")
      try {
        const res = await fetch("/api/contacts/discover/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selectedEmails,
            candidates: preview.candidates,
            scannedRowIds: preview.scannedRowIds,
            nameOverrides,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to apply")
        const result = data as ApplyContactDiscoveryResult
        if (result.createdCount > 0) {
          toast.success(
            `Created ${result.createdCount} contact${result.createdCount === 1 ? "" : "s"}` +
              ` · marked ${result.scannedRowsStamped} source items as reviewed`,
          )
        } else {
          toast.success(
            `No contacts created · marked ${result.scannedRowsStamped} source items as reviewed`,
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
    [preview, onApplied, reset, nameOverrides],
  )

  const applySelected = useCallback(() => {
    const emails = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([k]) => k)
    apply(emails)
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
            Discover contacts from sources
          </DialogTitle>
          <DialogDescription>
            Scans email participants (From / To / Cc / Bcc) across your
            synced inbox and dedups against existing contacts. Pick which
            ones to add — selected entries become contacts with status{" "}
            <code className="text-xs bg-muted px-1 rounded">initial</code>{" "}
            for review. Source items contributing to this preview get
            stamped as reviewed and won&apos;t be re-scanned unless
            re-parsed.
          </DialogDescription>
        </DialogHeader>

        {phase === "scanning" && (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">
              Scanning email participants…
            </span>
          </div>
        )}

        {phase === "preview" && preview && (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground border-b pb-2">
              <span>
                Scanned {preview.scannedRowCount} new/re-parsed email
                {preview.scannedRowCount === 1 ? "" : "s"} · Found{" "}
                {preview.candidates.length} new contact
                {preview.candidates.length === 1 ? "" : "s"} ·{" "}
                {selectedCount} selected
              </span>
            </div>

            {preview.candidates.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-12 text-sm text-muted-foreground">
                No new contacts found. Either every participant is already
                in your contacts list, or there&apos;s nothing new to scan.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Filter by name or email…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="flex-1"
                  />
                  <div className="flex items-center gap-2 px-2">
                    <Checkbox
                      id="discover-contacts-toggle-all"
                      checked={allFilteredChecked}
                      onCheckedChange={(v) => toggleAllFiltered(v === true)}
                    />
                    <label
                      htmlFor="discover-contacts-toggle-all"
                      className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap"
                    >
                      Toggle visible
                    </label>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto -mx-2 px-2 border rounded-md">
                  {filtered.map((c) => (
                    <ContactRow
                      key={c.email}
                      candidate={c}
                      checked={!!checked[c.email]}
                      nameOverride={nameOverrides[c.email]}
                      onToggle={(v) =>
                        setChecked((prev) => ({ ...prev, [c.email]: v }))
                      }
                      onNameChange={(name) =>
                        setNameOverrides((prev) => ({
                          ...prev,
                          [c.email]: name,
                        }))
                      }
                    />
                  ))}
                  {filtered.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-6">
                      No contacts match the filter.
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
                Create {selectedCount} contact
                {selectedCount === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === "applying" && (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">
              Creating contacts…
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ContactRow({
  candidate,
  checked,
  nameOverride,
  onToggle,
  onNameChange,
}: {
  candidate: DiscoveredContact
  checked: boolean
  nameOverride: string | undefined
  onToggle: (next: boolean) => void
  onNameChange: (next: string) => void
}) {
  // Effective name shown in the inline editor: override wins, otherwise
  // the discovered displayName, otherwise empty string (placeholder
  // shows "(unknown)" so the user knows what'll be saved).
  const value = nameOverride !== undefined ? nameOverride : candidate.displayName

  return (
    <div className="flex items-start gap-3 py-2 px-1 border-b last:border-b-0">
      <Checkbox
        className="mt-2"
        checked={checked}
        onCheckedChange={(v) => onToggle(v === true)}
      />
      <div className="flex-1 min-w-0 space-y-1">
        <Input
          value={value}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="(unknown)"
          className="h-8 text-sm font-medium"
        />
        <div className="text-xs text-muted-foreground truncate">
          {candidate.email} · mentioned in {candidate.occurrences} email
          {candidate.occurrences === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  )
}
