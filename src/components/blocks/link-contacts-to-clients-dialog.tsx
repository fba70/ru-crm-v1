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
import { Badge } from "@/components/ui/badge"
import { ArrowRight, Link2, Loader, AlertTriangle } from "lucide-react"
import type {
  ContactLinkPreview,
  ContactLinkProposal,
} from "@/app/api/contacts/link-to-clients/route"
import type { ApplyContactClientLinksResult } from "@/app/api/contacts/link-to-clients/apply/route"

type Phase = "idle" | "scanning" | "preview" | "applying"

export function LinkContactsToClientsDialog({
  trigger,
  onApplied,
}: {
  trigger: React.ReactNode
  /** Called after a successful apply so the parent can refresh its list. */
  onApplied: () => void
}) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [preview, setPreview] = useState<ContactLinkPreview | null>(null)
  // Map contactId → checked. Each proposal pairs one contact with one
  // client (multi-match collapses to alphabetically-first per server).
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
      const res = await fetch("/api/contacts/link-to-clients", {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to scan")
      const p = data as ContactLinkPreview
      setPreview(p)
      const initial: Record<string, boolean> = {}
      for (const proposal of p.proposals) {
        initial[proposal.contactId] = true
      }
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
    if (!q) return preview.proposals
    return preview.proposals.filter(
      (p) =>
        p.contactName.toLowerCase().includes(q) ||
        p.contactEmail.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q),
    )
  }, [preview, filter])

  const selectedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked],
  )

  const allFilteredChecked = useMemo(
    () =>
      filtered.length > 0 && filtered.every((p) => checked[p.contactId]),
    [filtered, checked],
  )

  const toggleAllFiltered = useCallback(
    (next: boolean) => {
      setChecked((prev) => {
        const out = { ...prev }
        for (const p of filtered) out[p.contactId] = next
        return out
      })
    },
    [filtered],
  )

  const apply = useCallback(async () => {
    if (!preview) return
    const links = preview.proposals
      .filter((p) => checked[p.contactId])
      .map((p) => ({ contactId: p.contactId, clientId: p.clientId }))
    if (links.length === 0) return

    setPhase("applying")
    try {
      const res = await fetch("/api/contacts/link-to-clients/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to apply")
      const result = data as ApplyContactClientLinksResult
      toast.success(
        `Linked ${result.linkedCount} contact${result.linkedCount === 1 ? "" : "s"} to clients`,
      )
      onApplied()
      setOpen(false)
      reset()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply")
      setPhase("preview")
    }
  }, [preview, checked, onApplied, reset])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Link contacts to clients
          </DialogTitle>
          <DialogDescription>
            Matches unlinked contacts to clients by email-domain ↔ website
            domain (subdomain-tolerant). Free-mail addresses (gmail, yahoo,
            outlook…) are skipped. Pick which links to apply.
          </DialogDescription>
        </DialogHeader>

        {phase === "scanning" && (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">
              Scanning contacts and clients…
            </span>
          </div>
        )}

        {phase === "preview" && preview && (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground border-b pb-2">
              <span>
                Considered {preview.scannedContactCount} unlinked contact
                {preview.scannedContactCount === 1 ? "" : "s"} · Found{" "}
                {preview.proposals.length} match
                {preview.proposals.length === 1 ? "" : "es"} · {selectedCount}{" "}
                selected
              </span>
            </div>

            {preview.proposals.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-12 text-sm text-muted-foreground text-center max-w-md mx-auto">
                No links to propose — every unlinked contact&apos;s email
                domain doesn&apos;t match any client website. Add or correct
                client websites first, then re-run.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Filter by contact or client name…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="flex-1"
                  />
                  <div className="flex items-center gap-2 px-2">
                    <Checkbox
                      id="link-toggle-all"
                      checked={allFilteredChecked}
                      onCheckedChange={(v) => toggleAllFiltered(v === true)}
                    />
                    <label
                      htmlFor="link-toggle-all"
                      className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap"
                    >
                      Toggle visible
                    </label>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto -mx-2 px-2 border rounded-md">
                  {filtered.map((p) => (
                    <ProposalRow
                      key={p.contactId}
                      proposal={p}
                      checked={!!checked[p.contactId]}
                      onToggle={(v) =>
                        setChecked((prev) => ({ ...prev, [p.contactId]: v }))
                      }
                    />
                  ))}
                  {filtered.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-6">
                      No proposals match the filter.
                    </div>
                  )}
                </div>
              </>
            )}

            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              {preview.proposals.length > 0 && (
                <Button onClick={apply} disabled={selectedCount === 0}>
                  Link {selectedCount} contact
                  {selectedCount === 1 ? "" : "s"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {phase === "applying" && (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">
              Linking contacts to clients…
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ProposalRow({
  proposal,
  checked,
  onToggle,
}: {
  proposal: ContactLinkProposal
  checked: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <label className="flex items-center gap-3 py-2 px-1 border-b last:border-b-0 cursor-pointer hover:bg-muted/40">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onToggle(v === true)}
      />
      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-sm">
        {/* Contact side */}
        <div className="min-w-0">
          <div className="font-medium truncate">{proposal.contactName}</div>
          <div className="text-xs text-muted-foreground truncate">
            {proposal.contactEmail}
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        {/* Client side */}
        <div className="min-w-0">
          <div className="font-medium truncate flex items-center gap-1.5">
            <span className="truncate">{proposal.clientName}</span>
            {proposal.ambiguous && (
              <Badge
                variant="secondary"
                className="bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[10px] px-1.5 py-0 h-4 shrink-0"
                title="Multiple clients share this domain — picked the alphabetically-first. Re-link manually if wrong."
              >
                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                ambiguous
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            matched on {proposal.clientDomain}
          </div>
        </div>
      </div>
    </label>
  )
}
