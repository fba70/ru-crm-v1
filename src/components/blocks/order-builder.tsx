"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Ban,
  Loader,
  Plus,
  RotateCcw,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react"
import type { OrderStatus } from "@/db/schema"
import type { OrderClientOption, OrderDetail } from "@/app/api/orders/route"
import {
  ORDER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  formatOrderAmount,
  isOrderEditable,
} from "@/lib/orders-format"

const DEFAULT_CURRENCY = "RUB"

// One product line being built client-side. `unitPrice` + `quantity` are
// editable; position price (unit × qty) + the order total are derived.
export type DraftLine = {
  productId: string
  productName: string
  unitPrice: number
  quantity: number
}

// Minimal product shape the catalog hands to the builder when adding a line.
export type AddableProduct = {
  id: string
  name: string
  price: number | null
}

export type OrderBuilder = ReturnType<typeof useOrderBuilder>

// Owns the whole order-building session: the open/edit state, the draft line
// items, and the persistence calls. Lives in the page so it survives tab
// switches and the catalog table can feed products into it.
export function useOrderBuilder({ onSaved }: { onSaved?: () => void } = {}) {
  const [isActive, setIsActive] = useState(false)
  const [mode, setMode] = useState<"create" | "edit">("create")
  const [orderId, setOrderId] = useState<string | null>(null)
  const [status, setStatus] = useState<OrderStatus>("draft")
  const [clientId, setClientId] = useState<string | null>(null)
  const [description, setDescription] = useState("")
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [loading, setLoading] = useState(false) // hydrating an edit
  const [saving, setSaving] = useState(false)

  const [clientOptions, setClientOptions] = useState<OrderClientOption[]>([])
  const clientsLoaded = useRef(false)

  const loadClients = useCallback(async () => {
    if (clientsLoaded.current) return
    clientsLoaded.current = true
    try {
      const res = await fetch("/api/orders?clientOptions=1")
      const data = await res.json()
      setClientOptions(data.clients ?? [])
    } catch {
      clientsLoaded.current = false
    }
  }, [])

  const reset = useCallback(() => {
    setMode("create")
    setOrderId(null)
    setStatus("draft")
    setClientId(null)
    setDescription("")
    setCurrency(DEFAULT_CURRENCY)
    setLines([])
  }, [])

  const openNew = useCallback(() => {
    reset()
    setIsActive(true)
    loadClients()
  }, [reset, loadClients])

  const openEdit = useCallback(
    async (id: string) => {
      setIsActive(true)
      setMode("edit")
      setOrderId(id)
      setLoading(true)
      loadClients()
      try {
        const res = await fetch(`/api/orders?id=${encodeURIComponent(id)}`)
        if (!res.ok) {
          toast.error("Failed to load order")
          setIsActive(false)
          return
        }
        const { order } = (await res.json()) as { order: OrderDetail }
        setStatus(order.status)
        setClientId(order.clientId)
        setDescription(order.description ?? "")
        setCurrency(order.currency)
        setLines(
          order.items.map((i) => ({
            productId: i.productId,
            productName: i.productName ?? i.productId,
            unitPrice: i.unitPrice,
            quantity: i.quantity,
          })),
        )
      } catch {
        toast.error("Failed to load order")
        setIsActive(false)
      } finally {
        setLoading(false)
      }
    },
    [loadClients],
  )

  const close = useCallback(() => {
    setIsActive(false)
    reset()
  }, [reset])

  // Terminal-status orders open as a read-only preview. `draft` +
  // `awaiting_client` are internally editable (see orders-format).
  const readOnly = mode === "edit" && !isOrderEditable(status)

  const addProduct = useCallback((p: AddableProduct, qty: number) => {
    const quantity = Math.max(1, Math.trunc(qty) || 1)
    setLines((prev) => {
      // Merge a repeat add into the existing line instead of duplicating it.
      const i = prev.findIndex((l) => l.productId === p.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], quantity: next[i].quantity + quantity }
        return next
      }
      return [
        ...prev,
        {
          productId: p.id,
          productName: p.name,
          unitPrice: p.price ?? 0,
          quantity,
        },
      ]
    })
  }, [])

  const setQuantity = useCallback((productId: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.productId === productId
          ? { ...l, quantity: Math.max(1, Math.trunc(qty) || 1) }
          : l,
      ),
    )
  }, [])

  const setUnitPrice = useCallback((productId: string, price: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.productId === productId
          ? {
              ...l,
              unitPrice: Math.max(0, Number.isFinite(price) ? price : 0),
            }
          : l,
      ),
    )
  }, [])

  const removeLine = useCallback((productId: string) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId))
  }, [])

  const total = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)

  // Full save (header + line items). The server recomputes position prices +
  // the order total and replaces the whole item set.
  const persist = useCallback(
    async (targetStatus: OrderStatus): Promise<boolean> => {
      if (!clientId) {
        toast.error("Select a client first")
        return false
      }
      if (targetStatus === "awaiting_client" && lines.length === 0) {
        toast.error("Add at least one product before sending to the client")
        return false
      }
      setSaving(true)
      try {
        const items = lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        }))
        const payload = {
          clientId,
          description,
          currency,
          status: targetStatus,
          items,
        }
        const res =
          mode === "create"
            ? await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              })
            : await fetch("/api/orders", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: orderId, ...payload }),
              })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          toast.error(e.error || "Failed to save order")
          return false
        }
        return true
      } catch {
        toast.error("Failed to save order")
        return false
      } finally {
        setSaving(false)
      }
    },
    [clientId, description, currency, lines, mode, orderId],
  )

  const saveDraft = useCallback(async () => {
    // New orders default to draft; editing keeps the current editable status
    // (a "Save" on an awaiting_client order leaves it sent).
    const target: OrderStatus = mode === "create" ? "draft" : status
    if (await persist(target)) {
      toast.success("Order saved")
      close()
      onSaved?.()
    }
  }, [persist, mode, status, close, onSaved])

  const sendToClient = useCallback(async () => {
    if (await persist("awaiting_client")) {
      toast.success("Order sent to client")
      close()
      onSaved?.()
    }
  }, [persist, close, onSaved])

  // Back-to-draft persists the current draft lines too (preserves edits and,
  // for a cancelled order, reopens it).
  const backToDraft = useCallback(async () => {
    if (await persist("draft")) {
      toast.success("Order moved to draft")
      close()
      onSaved?.()
    }
  }, [persist, close, onSaved])

  // Cancel is a pure status flip — works regardless of items / read-only.
  const cancelOrder = useCallback(async () => {
    if (mode !== "edit" || !orderId) {
      // Nothing persisted yet — just discard the in-progress order.
      close()
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, statusOnly: true, status: "cancelled" }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        toast.error(e.error || "Failed to cancel order")
        return
      }
      toast.success("Order cancelled")
      close()
      onSaved?.()
    } catch {
      toast.error("Failed to cancel order")
    } finally {
      setSaving(false)
    }
  }, [mode, orderId, close, onSaved])

  return {
    isActive,
    mode,
    orderId,
    status,
    readOnly,
    loading,
    saving,
    clientId,
    description,
    currency,
    lines,
    total,
    clientOptions,
    openNew,
    openEdit,
    close,
    setClientId,
    setDescription,
    addProduct,
    setQuantity,
    setUnitPrice,
    removeLine,
    saveDraft,
    sendToClient,
    backToDraft,
    cancelOrder,
  }
}

// ── Add-to-order popover (rendered per catalog row) ──────────────────
export function AddToOrderButton({
  onAdd,
  disabled,
}: {
  onAdd: (qty: number) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState("1")

  const commit = () => {
    const n = Math.max(1, Math.trunc(Number(qty)) || 1)
    onAdd(n)
    setOpen(false)
    setQty("1")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 space-y-2" align="end">
        <div className="text-xs font-medium text-muted-foreground">
          Quantity
        </div>
        <Input
          type="number"
          min={1}
          autoFocus
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
          }}
        />
        <Button size="sm" className="w-full" onClick={commit}>
          Add to order
        </Button>
      </PopoverContent>
    </Popover>
  )
}

// ── Sticky order panel (rendered atop the Catalog tab while active) ───
export function OrderBuilderPanel({ builder }: { builder: OrderBuilder }) {
  if (!builder.isActive) return null

  const {
    mode,
    status,
    readOnly,
    loading,
    saving,
    clientId,
    description,
    currency,
    lines,
    total,
    clientOptions,
  } = builder

  const title =
    mode === "create"
      ? "New order"
      : readOnly
        ? "Order preview"
        : "Edit order"

  return (
    <Card className="sticky top-2 z-20 border-primary/40 shadow-lg dark:border-gray-600">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold">{title}</span>
          {mode === "edit" && (
            <Badge
              variant="secondary"
              className={ORDER_STATUS_COLOR[status] ?? ""}
            >
              {ORDER_STATUS_LABEL[status] ?? status}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close order"
          onClick={builder.close}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="h-24 flex items-center justify-center">
            <Loader className="animate-spin h-6 w-6" />
          </div>
        ) : (
          <>
            {/* Core attributes: client + description. */}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_1fr]">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Client *</span>
                <Select
                  value={clientId ?? ""}
                  onValueChange={(v) => builder.setClientId(v)}
                  disabled={readOnly}
                >
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
                <span className="text-xs text-muted-foreground">
                  Description
                </span>
                <Textarea
                  rows={1}
                  className="min-h-9"
                  placeholder="Optional note about this order"
                  value={description}
                  onChange={(e) => builder.setDescription(e.target.value)}
                  disabled={readOnly}
                />
              </div>
            </div>

            {/* Line items. */}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="w-32 text-right">
                      Unit price
                    </TableHead>
                    <TableHead className="w-24 text-right">Qty</TableHead>
                    <TableHead className="w-32 text-right">Position</TableHead>
                    {!readOnly && <TableHead className="w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={readOnly ? 4 : 5}
                        className="h-20 text-center text-muted-foreground text-sm"
                      >
                        No products yet — search the catalog below and click
                        “Add to order”.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lines.map((l) => (
                      <TableRow key={l.productId}>
                        <TableCell className="font-medium">
                          {l.productName}
                        </TableCell>
                        <TableCell className="text-right">
                          {readOnly ? (
                            <span className="tabular-nums">
                              {formatOrderAmount(l.unitPrice, currency)}
                            </span>
                          ) : (
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={String(l.unitPrice)}
                              onChange={(e) =>
                                builder.setUnitPrice(
                                  l.productId,
                                  Number(e.target.value),
                                )
                              }
                              className="h-8 w-28 ml-auto text-right tabular-nums"
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {readOnly ? (
                            <span className="tabular-nums">{l.quantity}</span>
                          ) : (
                            <Input
                              type="number"
                              min={1}
                              value={String(l.quantity)}
                              onChange={(e) =>
                                builder.setQuantity(
                                  l.productId,
                                  Number(e.target.value),
                                )
                              }
                              className="h-8 w-20 ml-auto text-right tabular-nums"
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatOrderAmount(
                            l.unitPrice * l.quantity,
                            currency,
                          )}
                        </TableCell>
                        {!readOnly && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Remove line"
                              onClick={() => builder.removeLine(l.productId)}
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

            {/* Total + actions. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Total: </span>
                <span className="font-semibold tabular-nums">
                  {formatOrderAmount(total, currency)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {lines.length} {lines.length === 1 ? "item" : "items"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {readOnly ? (
                  <>
                    {status === "cancelled" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={builder.backToDraft}
                        disabled={saving}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Reopen as draft
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={builder.close}
                    >
                      Close
                    </Button>
                  </>
                ) : (
                  <>
                    {mode === "edit" && status === "awaiting_client" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={builder.backToDraft}
                        disabled={saving}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Back to draft
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={builder.cancelOrder}
                      disabled={saving}
                    >
                      <Ban className="h-4 w-4 mr-1" />
                      {mode === "edit" ? "Cancel order" : "Discard"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={builder.saveDraft}
                      disabled={saving}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      {mode === "create" ? "Save draft" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={builder.sendToClient}
                      disabled={saving}
                    >
                      <Send className="h-4 w-4 mr-1" />
                      Send to client
                    </Button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
