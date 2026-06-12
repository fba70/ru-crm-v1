"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  ChevronRight,
  Loader,
  PackageCheck,
  SkipForward,
  Sparkles,
  X,
} from "lucide-react"
import type { OrderClientOption } from "@/app/api/orders/route"
import type { OrderRequestItemView } from "@/app/api/order-requests/route"
import { hasAnyFilter } from "@/lib/order-request"

// ── "New order from request" dialog ──────────────────────────────────
// Same client + comment inputs as "New order", plus the pasted free-text
// client message. Submitting creates the order_request and runs the LLM
// split (can take a few seconds), then hands the request id to the page to
// start the assembly wizard.
export function NewOrderFromRequestDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (requestId: string) => void
}) {
  const [clientOptions, setClientOptions] = useState<OrderClientOption[]>([])
  const [clientId, setClientId] = useState<string>("")
  const [comment, setComment] = useState("")
  const [rawText, setRawText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    if (!open || loaded.current) return
    loaded.current = true
    fetch("/api/orders?clientOptions=1")
      .then((r) => r.json())
      .then((d) => setClientOptions(d.clients ?? []))
      .catch(() => {
        loaded.current = false
      })
  }, [open])

  const reset = () => {
    setClientId("")
    setComment("")
    setRawText("")
  }

  const submit = async () => {
    if (!clientId) {
      toast.error("Select a client first")
      return
    }
    if (!rawText.trim()) {
      toast.error("Paste the client's request first")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/order-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, comment, rawText }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Failed to analyse the request")
        return
      }
      onCreated(data.id as string)
      reset()
      onOpenChange(false)
    } catch {
      toast.error("Failed to analyse the request")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New order from request</DialogTitle>
          <DialogDescription>
            Paste the client&rsquo;s free-text message. We&rsquo;ll split it into
            product requests and walk you through assembling the order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Client *</span>
            <Select value={clientId} onValueChange={setClientId} disabled={submitting}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a client" />
              </SelectTrigger>
              <SelectContent>
                {clientOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Comment</span>
            <Textarea
              rows={1}
              className="min-h-9"
              placeholder="Optional note (becomes the order description)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">
              Client request *
            </span>
            <Textarea
              rows={8}
              placeholder="Paste the WhatsApp / email / chat message here…"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader className="h-4 w-4 mr-1 animate-spin" />
                Analysing the request…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1" />
                Analyse &amp; start
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Per-step wizard strip ────────────────────────────────────────────
// Rendered above the order builder while assembling. Shows the current
// intent item + what it was matched on, and the step controls. The catalog
// table below is pre-filtered to this item's filters / search phrase; the
// rep adds products from it, then advances.
const FILTER_LABELS: Record<string, string> = {
  category: "Category",
  type: "Type",
  color: "Color",
  sugar: "Sugar",
  aging: "Aging",
  bottleVolume: "Volume",
  countryName: "Country",
  priceMin: "From ₽",
  priceMax: "To ₽",
}

export function OrderRequestWizardStrip({
  step,
  total,
  item,
  onSkip,
  onNext,
  onSkipRest,
  onClose,
}: {
  step: number
  total: number
  item: OrderRequestItemView
  onSkip: () => void
  onNext: () => void
  onSkipRest: () => void
  onClose: () => void
}) {
  const isLast = step >= total - 1

  // Chips describing how the catalog was narrowed for this step.
  const filterChips: string[] = []
  if (item.mode === "discovery" && hasAnyFilter(item.filters)) {
    for (const [key, label] of Object.entries(FILTER_LABELS)) {
      const v = (item.filters as Record<string, unknown>)[key]
      if (v !== undefined && v !== null && v !== "") {
        filterChips.push(`${label}: ${v}`)
      }
    }
  }

  return (
    <Card className="border-primary/50 bg-primary/5 dark:border-gray-600">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold">
            Request item {step + 1} of {total}
          </span>
          <Badge variant="secondary">
            {item.mode === "explicit" ? "Named product" : "Discovery"}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Exit assistant (keep the order)"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-1">
          {item.label && <div className="font-medium">{item.label}</div>}
          <div className="text-sm text-muted-foreground italic">
            &ldquo;{item.rawSnippet}&rdquo;
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {item.quantityHint && (
            <Badge variant="outline" className="font-normal">
              Asked: {item.quantityHint}
            </Badge>
          )}
          {item.mode === "explicit" && item.searchPhrase && (
            <Badge variant="outline" className="font-normal">
              Search: {item.searchPhrase}
            </Badge>
          )}
          {filterChips.map((c) => (
            <Badge key={c} variant="outline" className="font-normal">
              {c}
            </Badge>
          ))}
          {item.mode === "discovery" &&
            !hasAnyFilter(item.filters) &&
            item.searchPhrase && (
              <Badge variant="outline" className="font-normal">
                Search: {item.searchPhrase}
              </Badge>
            )}
        </div>

        <p className="text-xs text-muted-foreground">
          Pick matching products from the catalog below and click{" "}
          <span className="font-medium">Add</span>. Adjust quantities in the
          order, then move on.
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onSkipRest}>
            Skip the rest
          </Button>
          <Button variant="outline" size="sm" onClick={onSkip}>
            <SkipForward className="h-4 w-4 mr-1" />
            Skip this
          </Button>
          <Button size="sm" onClick={onNext}>
            {isLast ? (
              <>
                <PackageCheck className="h-4 w-4 mr-1" />
                Finish &amp; review
              </>
            ) : (
              <>
                Next item
                <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
