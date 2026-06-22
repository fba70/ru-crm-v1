"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader, Wand2 } from "lucide-react"
import { toast } from "sonner"
import type { DiscoveryPreview } from "@/app/api/discovery/preview/route"
import type { ApplyDiscoveryResult } from "@/app/api/discovery/apply/route"

// One-click "Magic" — runs the same discovery flow as <DiscoverDialog>, but
// with no preview UI: it scans, auto-selects, and applies in one shot.
//   • period  → last day
//   • already-scanned items are skipped (the default)
//   • selection → mirrors the dialog's DEFAULT auto-selection exactly:
//     companies/contacts are checked unless they're a likely duplicate or
//     low confidence; links are checked unless low confidence. So Magic
//     creates the same rows a user would get by opening the dialog and
//     clicking Apply without touching any checkbox.
//
// Same preview→apply two-call sequence and payload shape as the dialog; only
// the (now-default) selection and confirmation steps are removed.

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

export function MagicDiscoverButton({
  onApplied,
}: {
  /** Called after a successful apply so the parent can refresh its lists. */
  onApplied: () => void
}) {
  const [running, setRunning] = useState(false)

  const handleClick = async () => {
    setRunning(true)
    try {
      // 1. Scan — last day, skip already-scanned (the dialog's default).
      const previewRes = await fetch("/api/discovery/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period: "last_day",
          includeAlreadyScanned: false,
        }),
      })
      const previewData = await previewRes.json()
      if (!previewRes.ok) {
        throw new Error(previewData.error || "Не удалось выполнить поиск")
      }
      const preview = previewData as DiscoveryPreview

      // 2. Auto-select using the dialog's DEFAULT rules: skip likely
      // duplicates and low-confidence candidates; links skip only low
      // confidence. (See <DiscoverDialog> startScan.)
      const selectedClientKeys = preview.clientCandidates
        .filter((c) => !c.possibleDuplicate && c.confidence !== "low")
        .map((c) => c.normalisedKey)
      const selectedContactEmails = preview.contactCandidates
        .filter((c) => !c.possibleDuplicate && c.confidence !== "low")
        .map((c) => c.email)
      const selectedLinks = preview.linkProposals
        .filter((lp) => lp.confidence !== "low")
        .map((lp) => ({ contact: lp.contact, client: lp.client }))

      const totalSelected =
        selectedClientKeys.length +
        selectedContactEmails.length +
        selectedLinks.length

      // 3. Apply — same payload the dialog builds. Always sent (even when
      // nothing is selected) so scannedRowIds get stamped exactly like the
      // dialog's Apply, and excluded duplicates / low-confidence rows aren't
      // re-surfaced on the next run.
      const applyRes = await fetch("/api/discovery/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedClientKeys,
          selectedContactEmails,
          contactNameOverrides: {},
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
      const applyData = await applyRes.json()
      if (!applyRes.ok) {
        throw new Error(applyData.error || "Не удалось применить")
      }
      const result = applyData as ApplyDiscoveryResult

      if (totalSelected === 0) {
        // No candidates, or all were excluded as duplicates / low confidence.
        toast.info(
          `Новых компаний, контактов и связей не найдено · просмотрено ${result.scannedRowsStamped}`,
        )
        onApplied()
        return
      }

      const revived = result.clientsRevived + result.contactsRevived
      toast.success(
        `Создано: ${result.clientsCreated} ${plural(result.clientsCreated, ["клиент", "клиента", "клиентов"])} · ` +
          `${result.contactsCreated} ${plural(result.contactsCreated, ["контакт", "контакта", "контактов"])} · ` +
          `${result.linksApplied} ${plural(result.linksApplied, ["связь", "связи", "связей"])}` +
          (revived ? ` · восстановлено ${revived}` : "") +
          (result.clientsEnriched ? ` · дополнено ${result.clientsEnriched}` : "") +
          ` · просмотрено ${result.scannedRowsStamped}`,
      )
      onApplied()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось выполнить поиск",
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
