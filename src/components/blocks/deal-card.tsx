"use client"

import { useState, useTransition } from "react"
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
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Building2, CalendarClock, Pencil } from "lucide-react"
import { toast } from "sonner"
import type {
  DealRow,
  DealFunnelStageOption,
} from "@/app/api/deals/route"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { dealStageLabel } from "@/lib/deal-funnel"

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
  RUB: "₽",
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

// A labeled deal text field (Description / Reason / Changes) shown clamped
// to 3 lines on the card, with the FULL text revealed in a hover-card on
// hover, keyboard focus, or click — so long text is readable without opening
// the edit dialog. Content is portaled, so it isn't clipped by the card.
// Mirrors the dashboard-card MessageField behaviour.
function TextPreview({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </div>
      <HoverCard
        open={open}
        onOpenChange={setOpen}
        openDelay={150}
        closeDelay={100}
      >
        <HoverCardTrigger asChild>
          <p
            tabIndex={0}
            onClick={() => setOpen((o) => !o)}
            className="text-muted-foreground line-clamp-3 whitespace-pre-wrap cursor-pointer rounded -mx-1 px-1 transition-colors hover:bg-muted/40 focus:bg-muted/40 outline-hidden"
          >
            {text}
          </p>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          className="w-96 max-h-80 overflow-y-auto"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            {label}
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
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
  // Display deal amounts in RUB (₽) regardless of the row's stored
  // currency — the business operates in roubles (orders already default
  // to RUB), and legacy deals carry an EUR/USD default we don't want to
  // surface on the card.
  const amount = formatAmount(deal.value, "RUB")
  const [isPending, startTransition] = useTransition()
  // Both soft-delete states dim the card; each gets its own badge.
  const isSoftDeleted = deal.status === "cancelled" || deal.status === "deleted"

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
          toast.error(err.error || "Не удалось переместить сделку")
          return
        }
        const stageName = stages.find((s) => s.id === nextStageId)?.name
        toast.success(`Перемещено: ${stageName ? dealStageLabel(stageName) : "этап"}`)
        onChanged()
      } catch {
        toast.error("Не удалось переместить сделку")
      }
    })
  }

  return (
    <Card
      className={`flex flex-col bg-muted/50 dark:bg-muted/30 border-muted dark:border-gray-600 ${
        isSoftDeleted ? "opacity-60" : ""
      }`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{deal.name}</CardTitle>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge className={stageClass} variant="secondary">
              {dealStageLabel(deal.funnelStageName)}
            </Badge>
            {deal.status === "cancelled" && (
              <Badge
                variant="secondary"
                className="bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"
              >
                Отменена
              </Badge>
            )}
            {deal.status === "deleted" && (
              <Badge
                variant="secondary"
                className="bg-red-500/15 text-red-600 dark:text-red-300"
              >
                Удалена
              </Badge>
            )}
          </div>
        </div>
        <DealEditDialog
          mode="edit"
          deal={deal}
          onSuccess={onChanged}
          trigger={
            <Button variant="ghost" size="icon" aria-label="Редактировать сделку">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="flex-1 space-y-3 text-sm">
        {deal.description && (
          <TextPreview label="Описание" text={deal.description} />
        )}
        {deal.reasoning && <TextPreview label="Причина" text={deal.reasoning} />}
        {deal.changes && <TextPreview label="Изменения" text={deal.changes} />}

        <div className="space-y-1 text-muted-foreground">
          {deal.clientName && (
            <div className="flex items-center gap-2 truncate">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{deal.clientName}</span>
            </div>
          )}
          <div className="flex items-center gap-2 truncate">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Создано {formatDate(deal.createdAt)}</span>
          </div>
        </div>

        {amount && (
          <div className="text-base font-medium text-foreground">{amount}</div>
        )}

        <div className="pt-1 space-y-1">
          <div className="text-xs text-muted-foreground">
            Переместить по воронке:
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
                  {dealStageLabel(s.name)}{" "}
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
