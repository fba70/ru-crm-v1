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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Building2,
  ChevronDown,
  Link2,
  Loader,
  Sparkles,
  User,
} from "lucide-react"
import type {
  ClientCandidate,
  ContactCandidate,
  ContactRef,
  ClientRef,
  DiscoveryPeriod,
  DiscoveryPreview,
  LinkProposal,
} from "@/app/api/discovery/preview/route"
import type { ApplyDiscoveryResult } from "@/app/api/discovery/apply/route"

type Phase = "idle" | "scanning" | "preview" | "applying"

const PERIODS: { value: DiscoveryPeriod; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "last_day", label: "Last day" },
  { value: "last_week", label: "Last week" },
  { value: "last_month", label: "Last month" },
]

// Stable string encodings — used as map keys and to round-trip a selected
// link back into its ContactRef / ClientRef pair on apply.
function contactRefKey(ref: ContactRef): string {
  return ref.kind === "existing" ? `c:e:${ref.id}` : `c:n:${ref.email}`
}
function clientRefKey(ref: ClientRef): string {
  return ref.kind === "existing" ? `l:e:${ref.id}` : `l:n:${ref.normalisedKey}`
}
function linkKey(p: LinkProposal): string {
  return `${contactRefKey(p.contact)}|${clientRefKey(p.client)}`
}

export function DiscoverDialog({
  trigger,
  onApplied,
}: {
  trigger: React.ReactNode
  /** Called after a successful apply so the parent can refresh its lists. */
  onApplied: () => void
}) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [preview, setPreview] = useState<DiscoveryPreview | null>(null)
  const [period, setPeriod] = useState<DiscoveryPeriod>("all")
  const [includeAlreadyScanned, setIncludeAlreadyScanned] = useState(false)

  // Selection state (all default to checked when a preview loads).
  const [clientChecked, setClientChecked] = useState<Record<string, boolean>>({})
  const [contactChecked, setContactChecked] = useState<Record<string, boolean>>({})
  const [contactNameOverrides, setContactNameOverrides] = useState<
    Record<string, string>
  >({})
  const [linkChecked, setLinkChecked] = useState<Record<string, boolean>>({})

  // Per-section filters.
  const [clientFilter, setClientFilter] = useState("")
  const [contactFilter, setContactFilter] = useState("")
  const [linkFilter, setLinkFilter] = useState("")

  const reset = useCallback(() => {
    setPhase("idle")
    setPreview(null)
    setPeriod("all")
    setIncludeAlreadyScanned(false)
    setClientChecked({})
    setContactChecked({})
    setContactNameOverrides({})
    setLinkChecked({})
    setClientFilter("")
    setContactFilter("")
    setLinkFilter("")
  }, [])

  const startScan = useCallback(
    async (p: DiscoveryPeriod, includeScanned: boolean) => {
      setPhase("scanning")
      try {
        const res = await fetch("/api/discovery/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ period: p, includeAlreadyScanned: includeScanned }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to scan")
        const dp = data as DiscoveryPreview
        setPreview(dp)

        const c: Record<string, boolean> = {}
        // Pre-uncheck likely duplicates (name variant of an existing client)
        // AND low-confidence candidates so they aren't created by default —
        // the operator opts in after reviewing.
        for (const cand of dp.clientCandidates)
          c[cand.normalisedKey] =
            !cand.possibleDuplicate && cand.confidence !== "low"
        setClientChecked(c)

        const ct: Record<string, boolean> = {}
        for (const cand of dp.contactCandidates)
          ct[cand.email] = !cand.possibleDuplicate && cand.confidence !== "low"
        setContactChecked(ct)
        setContactNameOverrides({})

        const lk: Record<string, boolean> = {}
        // Low-confidence links (ambiguous company attribution) start unchecked.
        for (const lp of dp.linkProposals)
          lk[linkKey(lp)] = lp.confidence !== "low"
        setLinkChecked(lk)

        setPhase("preview")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to scan")
        setPhase("idle")
      }
    },
    [],
  )

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) {
        startScan("all", false)
      } else {
        reset()
      }
    },
    [startScan, reset],
  )

  const onPeriodChange = useCallback(
    (p: DiscoveryPeriod) => {
      setPeriod(p)
      startScan(p, includeAlreadyScanned)
    },
    [startScan, includeAlreadyScanned],
  )

  const onIncludeScannedChange = useCallback(
    (next: boolean) => {
      setIncludeAlreadyScanned(next)
      startScan(period, next)
    },
    [startScan, period],
  )

  // ── Filtered views ───────────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    if (!preview) return []
    const q = clientFilter.trim().toLowerCase()
    if (!q) return preview.clientCandidates
    return preview.clientCandidates.filter((c) =>
      c.displayName.toLowerCase().includes(q),
    )
  }, [preview, clientFilter])

  const filteredContacts = useMemo(() => {
    if (!preview) return []
    const q = contactFilter.trim().toLowerCase()
    if (!q) return preview.contactCandidates
    return preview.contactCandidates.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q),
    )
  }, [preview, contactFilter])

  const filteredLinks = useMemo(() => {
    if (!preview) return []
    const q = linkFilter.trim().toLowerCase()
    if (!q) return preview.linkProposals
    return preview.linkProposals.filter(
      (l) =>
        l.contactName.toLowerCase().includes(q) ||
        l.contactEmail.toLowerCase().includes(q) ||
        l.clientName.toLowerCase().includes(q),
    )
  }, [preview, linkFilter])

  // ── Counts ──────────────────────────────────────────────────────────
  const selectedClientCount = useMemo(
    () => Object.values(clientChecked).filter(Boolean).length,
    [clientChecked],
  )
  const selectedContactCount = useMemo(
    () => Object.values(contactChecked).filter(Boolean).length,
    [contactChecked],
  )
  const selectedLinkCount = useMemo(
    () => Object.values(linkChecked).filter(Boolean).length,
    [linkChecked],
  )
  const totalSelected =
    selectedClientCount + selectedContactCount + selectedLinkCount

  // ── Apply ───────────────────────────────────────────────────────────
  const apply = useCallback(
    async (markReviewedOnly: boolean) => {
      if (!preview) return
      setPhase("applying")
      try {
        const selectedClientKeys = markReviewedOnly
          ? []
          : Object.entries(clientChecked)
              .filter(([, v]) => v)
              .map(([k]) => k)
        const selectedContactEmails = markReviewedOnly
          ? []
          : Object.entries(contactChecked)
              .filter(([, v]) => v)
              .map(([k]) => k)
        const selectedLinks = markReviewedOnly
          ? []
          : preview.linkProposals
              .filter((lp) => linkChecked[linkKey(lp)])
              .map((lp) => ({ contact: lp.contact, client: lp.client }))

        const res = await fetch("/api/discovery/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selectedClientKeys,
            selectedContactEmails,
            contactNameOverrides,
            selectedLinks,
            scannedRowIds: preview.scannedRowIds,
            candidates: {
              clients: preview.clientCandidates,
              contacts: preview.contactCandidates,
            },
            clientEnrichments: preview.clientEnrichments,
            nativeNames: preview.nativeNames,
            phones: preview.phones,
            positions: preview.positions,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to apply")
        const result = data as ApplyDiscoveryResult
        const revived = result.clientsRevived + result.contactsRevived
        toast.success(
          `${result.clientsCreated} client${result.clientsCreated === 1 ? "" : "s"} · ` +
            `${result.contactsCreated} contact${result.contactsCreated === 1 ? "" : "s"} · ` +
            `${result.linksApplied} link${result.linksApplied === 1 ? "" : "s"}` +
            (revived ? ` · ${revived} revived` : "") +
            (result.clientsEnriched ? ` · ${result.clientsEnriched} enriched` : "") +
            ` · ${result.scannedRowsStamped} reviewed`,
        )
        onApplied()
        setOpen(false)
        reset()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to apply")
        setPhase("preview")
      }
    },
    [preview, clientChecked, contactChecked, contactNameOverrides, linkChecked, onApplied, reset],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Discover from sources
          </DialogTitle>
          <DialogDescription>
            One-shot scan across parsed source items in your active
            organization. Selected entries land with status{" "}
            <code className="text-xs bg-muted px-1 rounded">initial</code> for
            review.
          </DialogDescription>
        </DialogHeader>

        {/* Period selector */}
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={period === p.value ? "default" : "outline"}
              onClick={() => onPeriodChange(p.value)}
              disabled={phase === "scanning" || phase === "applying"}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {phase === "scanning" && (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">
              Scanning source items…
            </span>
          </div>
        )}

        {phase === "applying" && (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">
              Applying…
            </span>
          </div>
        )}

        {phase === "preview" && preview && (
          <>
            {/* Summary bar */}
            <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-muted-foreground border-b pb-2">
              <span>
                Scanned {preview.scannedRowCount} item
                {preview.scannedRowCount === 1 ? "" : "s"} ·{" "}
                {preview.clientCandidates.length} companies ·{" "}
                {preview.contactCandidates.length} contacts ·{" "}
                {preview.linkProposals.length} links
              </span>
              <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap">
                <Checkbox
                  checked={includeAlreadyScanned}
                  onCheckedChange={(v) => onIncludeScannedChange(v === true)}
                />
                Re-scan already-reviewed items
              </label>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 -mx-1 px-1">
              {/* Companies */}
              <Section
                icon={<Building2 className="h-4 w-4" />}
                title="Companies"
                count={selectedClientCount}
                total={preview.clientCandidates.length}
                filter={clientFilter}
                onFilter={setClientFilter}
                onToggleVisible={(next) =>
                  setClientChecked((prev) => {
                    const out = { ...prev }
                    for (const c of filteredClients) out[c.normalisedKey] = next
                    return out
                  })
                }
                empty={preview.clientCandidates.length === 0}
                emptyLabel="No new companies found."
              >
                {filteredClients.map((c) => (
                  <ClientRow
                    key={c.normalisedKey}
                    candidate={c}
                    checked={!!clientChecked[c.normalisedKey]}
                    onToggle={(v) =>
                      setClientChecked((prev) => ({
                        ...prev,
                        [c.normalisedKey]: v,
                      }))
                    }
                  />
                ))}
              </Section>

              {/* Contacts */}
              <Section
                icon={<User className="h-4 w-4" />}
                title="Contacts"
                count={selectedContactCount}
                total={preview.contactCandidates.length}
                filter={contactFilter}
                onFilter={setContactFilter}
                onToggleVisible={(next) =>
                  setContactChecked((prev) => {
                    const out = { ...prev }
                    for (const c of filteredContacts) out[c.email] = next
                    return out
                  })
                }
                empty={preview.contactCandidates.length === 0}
                emptyLabel="No new contacts found."
              >
                {filteredContacts.map((c) => (
                  <ContactRow
                    key={c.email}
                    candidate={c}
                    checked={!!contactChecked[c.email]}
                    nameOverride={contactNameOverrides[c.email]}
                    onToggle={(v) =>
                      setContactChecked((prev) => ({ ...prev, [c.email]: v }))
                    }
                    onNameChange={(name) =>
                      setContactNameOverrides((prev) => ({
                        ...prev,
                        [c.email]: name,
                      }))
                    }
                  />
                ))}
              </Section>

              {/* Links */}
              <Section
                icon={<Link2 className="h-4 w-4" />}
                title="Links"
                count={selectedLinkCount}
                total={preview.linkProposals.length}
                filter={linkFilter}
                onFilter={setLinkFilter}
                onToggleVisible={(next) =>
                  setLinkChecked((prev) => {
                    const out = { ...prev }
                    for (const l of filteredLinks) out[linkKey(l)] = next
                    return out
                  })
                }
                empty={preview.linkProposals.length === 0}
                emptyLabel="No links to propose."
              >
                {filteredLinks.map((l) => {
                  const k = linkKey(l)
                  return (
                    <LinkRow
                      key={k}
                      proposal={l}
                      checked={!!linkChecked[k]}
                      onToggle={(v) =>
                        setLinkChecked((prev) => ({ ...prev, [k]: v }))
                      }
                    />
                  )
                })}
              </Section>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => apply(true)}>
                Mark all reviewed
              </Button>
              <Button onClick={() => apply(false)} disabled={totalSelected === 0}>
                Apply ({totalSelected})
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({
  icon,
  title,
  count,
  total,
  filter,
  onFilter,
  onToggleVisible,
  empty,
  emptyLabel,
  children,
}: {
  icon: React.ReactNode
  title: string
  count: number
  total: number
  filter: string
  onFilter: (v: string) => void
  onToggleVisible: (next: boolean) => void
  empty: boolean
  emptyLabel: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-md">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
        <span className="flex items-center gap-2">
          {icon}
          {title}
          <span className="text-xs text-muted-foreground">
            ({count}/{total})
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-2">
        {empty ? (
          <div className="text-center text-sm text-muted-foreground py-4">
            {emptyLabel}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Filter…"
                value={filter}
                onChange={(e) => onFilter(e.target.value)}
                className="flex-1 h-8"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => onToggleVisible(true)}
              >
                Select visible
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onToggleVisible(false)}
              >
                Clear visible
              </Button>
            </div>
            <div className="rounded-md border divide-y">{children}</div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

// Small coloured pill conveying discovery's self-rated confidence. `high` is
// quiet (it's the happy path); `medium` / `low` stand out so the operator
// knows what to double-check.
function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  if (level === "high")
    return (
      <Badge variant="secondary" className="text-[10px] px-1 py-0">
        high
      </Badge>
    )
  const cls =
    level === "medium"
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
      : "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30"
  return <Badge className={`text-[10px] px-1 py-0 ${cls}`}>{level}</Badge>
}

function ClientRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: ClientCandidate
  checked: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3 py-2 px-2">
      <Checkbox
        className="mt-1"
        checked={checked}
        onCheckedChange={(v) => onToggle(v === true)}
      />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="text-sm font-medium truncate flex items-center gap-1.5">
          <span className="truncate">{candidate.displayName}</span>
          <ConfidenceBadge level={candidate.confidence} />
        </div>
        <div className="text-xs text-muted-foreground truncate">
          mentioned in {candidate.occurrences} item
          {candidate.occurrences === 1 ? "" : "s"}
          {candidate.inferredWebUrl ? ` · ${candidate.inferredWebUrl}` : ""}
          {candidate.aliases.length > 0
            ? ` · aka ${candidate.aliases.join(", ")}`
            : ""}
        </div>
        {candidate.possibleDuplicate && (
          <Badge className="text-[10px] px-1 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
            Possible duplicate of {candidate.possibleDuplicate.name} — check to
            create as a separate client
          </Badge>
        )}
      </div>
    </div>
  )
}

function ContactRow({
  candidate,
  checked,
  nameOverride,
  onToggle,
  onNameChange,
}: {
  candidate: ContactCandidate
  checked: boolean
  nameOverride: string | undefined
  onToggle: (next: boolean) => void
  onNameChange: (next: string) => void
}) {
  const value =
    nameOverride !== undefined ? nameOverride : candidate.displayName
  return (
    <div className="flex items-start gap-3 py-2 px-2">
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
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
          <ConfidenceBadge level={candidate.confidence} />
          <span className="truncate">
            {candidate.email}
            {candidate.nativeName ? ` · ${candidate.nativeName}` : ""} ·
            mentioned in {candidate.occurrences} item
            {candidate.occurrences === 1 ? "" : "s"}
          </span>
        </div>
        {candidate.possibleDuplicate && (
          <Badge className="text-[10px] px-1 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
            Possible duplicate of {candidate.possibleDuplicate.name}
          </Badge>
        )}
      </div>
    </div>
  )
}

function LinkRow({
  proposal,
  checked,
  onToggle,
}: {
  proposal: LinkProposal
  checked: boolean
  onToggle: (next: boolean) => void
}) {
  const contactIsNew = proposal.contact.kind === "new"
  const clientIsNew = proposal.client.kind === "new"
  return (
    <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2 py-2 px-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onToggle(v === true)}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-1">
          {proposal.contactName}
          {contactIsNew && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0">
              new
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {proposal.contactEmail}
        </div>
      </div>
      <Link2 className="h-4 w-4 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-1">
          {proposal.clientName}
          {clientIsNew && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0">
              new
            </Badge>
          )}
          {proposal.ambiguous && (
            <Badge className="text-[10px] px-1 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
              ambiguous
            </Badge>
          )}
          <ConfidenceBadge level={proposal.confidence} />
        </div>
        <div className="text-xs text-muted-foreground truncate">
          matched on {proposal.matchedLabel}
        </div>
      </div>
    </div>
  )
}
