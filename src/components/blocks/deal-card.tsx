"use client"

import { useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Building2, CalendarClock, Pencil } from "lucide-react"
import { toast } from "sonner"
import type {
  DealRow,
  DealFunnelStageOption,
} from "@/app/api/deals/route"
import DealEditDialog from "@/components/forms/form-deal-edit"

// Stage-name-keyed colour map for the seeded system funnel. Customised
// org stages fall through to the neutral default — if persistent colours
// per stage become important later, add a `colour` column on
// `deal_funnel_stage` and key off that instead.
const STAGE_COLOR: Record<string, string> = {
  Qualification: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  Discovery: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  Pilot: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  Proposal: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  Negotiations: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  Closed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  Rejected: "bg-red-500/15 text-red-600 dark:text-red-300",
}
const STAGE_DEFAULT = "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CHF: "CHF ",
  CAD: "CA$",
  AUD: "A$",
}

function formatAmount(value: string | null, currency: string): string | null {
  if (value === null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const symbol = CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency} `
  // 0 decimals for whole numbers, up to 2 otherwise — keeps the card tidy.
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${symbol}${formatted}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function DealCard({
  deal,
  stages,
  onChanged,
}: {
  deal: DealRow
  stages: DealFunnelStageOption[]
  onChanged: () => void
}) {
  const stageClass = STAGE_COLOR[deal.funnelStageName] ?? STAGE_DEFAULT
  const amount = formatAmount(deal.value, deal.currency)
  const [isPending, startTransition] = useTransition()

  const handleStageChange = (nextStageId: string) => {
    if (nextStageId === deal.funnelStageId) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: deal.id, funnelStageId: nextStageId }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Failed to move deal")
          return
        }
        const stageName =
          stages.find((s) => s.id === nextStageId)?.name ?? "stage"
        toast.success(`Moved to ${stageName}`)
        onChanged()
      } catch {
        toast.error("Failed to move deal")
      }
    })
  }

  return (
    <Card
      className={`flex flex-col bg-muted/50 dark:bg-muted/30 border-muted dark:border-gray-600 ${
        deal.isCancelled ? "opacity-60" : ""
      }`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{deal.name}</CardTitle>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge className={stageClass} variant="secondary">
              {deal.funnelStageName}
            </Badge>
            {deal.isCancelled && (
              <Badge
                variant="secondary"
                className="bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"
              >
                Cancelled
              </Badge>
            )}
          </div>
        </div>
        <DealEditDialog
          mode="edit"
          deal={deal}
          onSuccess={onChanged}
          trigger={
            <Button variant="ghost" size="icon" aria-label="Edit deal">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="flex-1 space-y-3 text-sm">
        {deal.description && (
          <p className="text-muted-foreground line-clamp-3 whitespace-pre-wrap">
            {deal.description}
          </p>
        )}

        <div className="space-y-1 text-muted-foreground">
          {deal.clientName && (
            <div className="flex items-center gap-2 truncate">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{deal.clientName}</span>
            </div>
          )}
          <div className="flex items-center gap-2 truncate">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Created {formatDate(deal.createdAt)}</span>
          </div>
        </div>

        {amount && (
          <div className="text-base font-medium text-foreground">{amount}</div>
        )}

        <div className="pt-1 space-y-1">
          <div className="text-xs text-muted-foreground">
            Move the funnel phase:
          </div>
          <Select
            value={deal.funnelStageId}
            onValueChange={handleStageChange}
            disabled={isPending || stages.length === 0}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}{" "}
                  <span className="text-muted-foreground">
                    ({Math.round(s.closureProbability * 100)}%)
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
