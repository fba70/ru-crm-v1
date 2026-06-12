"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  CheckCircle2,
  ExternalLink,
  ImageOff,
  Loader,
  Minus,
  Plus,
  Trash2,
} from "lucide-react"
import { formatOrderAmount, formatOrderDate } from "@/lib/orders-format"
import type { GuestOrderView, GuestLineItem } from "@/server/order-links"
import {
  setQuantityAction,
  removeItemAction,
  confirmOrderAction,
} from "./actions"

// Quantity stepper for one line. Local input state seeds from the line
// quantity; the parent remounts this via a `key` that includes the quantity,
// so it re-seeds after every server commit without a sync effect.
function QtyStepper({
  line,
  disabled,
  onCommit,
}: {
  line: GuestLineItem
  disabled: boolean
  onCommit: (qty: number) => void
}) {
  const [value, setValue] = useState(String(line.quantity))

  const commit = (next: number) => {
    const q = Math.max(1, Math.trunc(next) || 1)
    setValue(String(q))
    if (q !== line.quantity) onCommit(q)
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={disabled || line.quantity <= 1}
        onClick={() => commit(line.quantity - 1)}
        aria-label="Decrease quantity"
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <Input
        type="number"
        min={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => commit(Number(value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit(Number(value))
          }
        }}
        className="h-8 w-16 text-center tabular-nums"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={disabled}
        onClick={() => commit(line.quantity + 1)}
        aria-label="Increase quantity"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export function GuestOrderReview({
  token,
  view,
}: {
  token: string
  view: GuestOrderView
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const editable = view.can.editQuantity || view.can.removeItem
  const confirmed = view.status === "confirmed"

  // Runs a guest action, surfaces failures, and refreshes the RSC on success.
  const run = (
    fn: () => Promise<{ ok: boolean; reason?: string }>,
    onOkMessage?: string,
  ) => {
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) {
        toast.error(
          r.reason === "conflict"
            ? "This order was updated elsewhere. Refreshing…"
            : r.reason === "forbidden"
              ? "This order can no longer be edited."
              : "Something went wrong. Please reload.",
        )
        router.refresh()
        return
      }
      if (onOkMessage) toast.success(onOkMessage)
      router.refresh()
    })
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Brand header */}
        <div className="flex items-center justify-center pb-2">
          {/* Local static SVG from /public — plain <img> keeps it config-free. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ast_logo.svg" alt="AST" className="h-10 w-auto" />
        </div>

        <Card>
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-xl">Review your order</CardTitle>
              <Badge variant="secondary">
                {formatOrderDate(view.orderDate)}
              </Badge>
            </div>
            {view.description && (
              <p className="text-sm text-muted-foreground">
                {view.description}
              </p>
            )}
          </CardHeader>

          <CardContent className="space-y-4">
            {confirmed && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <div className="font-medium">Order confirmed</div>
                  <div className="text-muted-foreground">
                    Thanks — your confirmation has been sent back. This page is
                    now read-only.
                  </div>
                </div>
              </div>
            )}

            {!editable && !confirmed && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                This order is currently read-only.
              </div>
            )}

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Image</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>Sugar</TableHead>
                    <TableHead className="text-right">Alcohol</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead>Country / Region</TableHead>
                    <TableHead className="w-28 text-right">
                      Unit price
                    </TableHead>
                    <TableHead className="w-36 text-center">Qty</TableHead>
                    <TableHead className="w-28 text-right">Position</TableHead>
                    {view.can.removeItem && <TableHead className="w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.items.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={view.can.removeItem ? 11 : 10}
                        className="h-20 text-center text-sm text-muted-foreground"
                      >
                        No items on this order.
                      </TableCell>
                    </TableRow>
                  ) : (
                    view.items.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>
                          {l.imageUrl ? (
                            <HoverCard openDelay={150} closeDelay={100}>
                              <HoverCardTrigger asChild>
                                {/* Remote catalog images (ast.wine CDN); plain
                                    <img> avoids next/image remote-host config. */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={l.imageUrl}
                                  alt={l.productName ?? "Product"}
                                  className="h-10 w-10 rounded object-cover bg-muted cursor-zoom-in"
                                  loading="lazy"
                                />
                              </HoverCardTrigger>
                              <HoverCardContent side="right" className="w-auto p-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={l.imageUrl}
                                  alt={l.productName ?? "Product"}
                                  className="max-h-80 max-w-80 rounded object-contain bg-muted"
                                />
                              </HoverCardContent>
                            </HoverCard>
                          ) : (
                            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                              <ImageOff className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            <span>{l.productName ?? "—"}</span>
                            {l.webPageUrl && (
                              <a
                                href={l.webPageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground shrink-0"
                                aria-label="Open product page"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {l.color ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {l.sugar ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {l.alcohol ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {l.bottleVolume ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {l.countryRegion ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatOrderAmount(l.unitPrice, view.currency)}
                        </TableCell>
                        <TableCell>
                          {view.can.editQuantity ? (
                            <QtyStepper
                              key={`${l.id}:${l.quantity}`}
                              line={l}
                              disabled={pending}
                              onCommit={(qty) =>
                                run(() =>
                                  setQuantityAction(token, l.id, qty),
                                )
                              }
                            />
                          ) : (
                            <div className="text-center tabular-nums">
                              {l.quantity}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatOrderAmount(l.positionPrice, view.currency)}
                        </TableCell>
                        {view.can.removeItem && (
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={pending}
                              aria-label="Remove item"
                              onClick={() =>
                                run(
                                  () => removeItemAction(token, l.id),
                                  "Item removed",
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-lg font-semibold tabular-nums">
                {formatOrderAmount(view.totalAmount, view.currency)}
              </span>
            </div>

            {view.can.confirm && (
              <div className="flex items-center justify-end gap-2 pt-2">
                {pending && (
                  <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                <Button
                  size="lg"
                  disabled={pending || view.items.length === 0}
                  onClick={() =>
                    run(
                      () => confirmOrderAction(token),
                      "Order confirmed — thank you!",
                    )
                  }
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Confirm order
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          You can adjust quantities or remove items, then confirm. You can’t add
          new products to this order.
        </p>
      </div>
    </div>
  )
}
