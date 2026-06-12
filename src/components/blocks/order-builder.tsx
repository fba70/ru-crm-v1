"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
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
  Copy,
  Link2,
  Loader,
  PackageCheck,
  Plus,
  RotateCcw,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react"
import type { OrderStatus } from "@/db/schema"
import type { OrderClientOption, OrderDetail } from "@/app/api/orders/route"
import type { OrderLinkMeta } from "@/server/order-links"
import {
  ORDER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  formatOrderAmount,
  formatOrderDate,
  isOrderEditable,
  isValidEmail,
} from "@/lib/orders-format"

// One product line being built client-side. `unitPrice` + `quantity` are
// editable; position price (unit × qty) + the order total are derived.
export type DraftLine = {
  productId: string
  productName: string
  unitPrice: number
  quantity: number
}

export type AddableProduct = {
  id: string
  name: string
  price: number | null
}

export type OrderBuilder = ReturnType<typeof useOrderBuilder>

type SendMode = "send" | "resend" | "reopen"

// Owns the order-building session: open/edit state, the draft line items, and
// the persistence calls. Lives in the page so it survives tab switches and the
// catalog table can feed products into it.
export function useOrderBuilder({ onSaved }: { onSaved?: () => void } = {}) {
  const [isActive, setIsActive] = useState(false)
  const [mode, setMode] = useState<"create" | "edit">("create")
  const [orderId, setOrderId] = useState<string | null>(null)
  const [status, setStatus] = useState<OrderStatus>("draft")
  const [clientId, setClientIdState] = useState<string | null>(null)
  const [clientEmail, setClientEmail] = useState<string | null>(null)
  const [description, setDescription] = useState("")
  const [currency, setCurrency] = useState("RUB")
  const [lines, setLines] = useState<DraftLine[]>([])
  const [link, setLink] = useState<OrderLinkMeta | null>(null)
  const [loading, setLoading] = useState(false)
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
    setClientIdState(null)
    setClientEmail(null)
    setDescription("")
    setCurrency("RUB")
    setLines([])
    setLink(null)
  }, [])

  const openNew = useCallback(() => {
    reset()
    setIsActive(true)
    loadClients()
  }, [reset, loadClients])

  const hydrate = useCallback((o: OrderDetail) => {
    setMode("edit")
    setOrderId(o.id)
    setStatus(o.status)
    setClientIdState(o.clientId)
    setClientEmail(o.clientEmail)
    setDescription(o.description ?? "")
    setCurrency(o.currency)
    setLink(o.link)
    setLines(
      o.items.map((i) => ({
        productId: i.productId,
        productName: i.productName ?? i.productId,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
      })),
    )
  }, [])

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
        hydrate(order)
      } catch {
        toast.error("Failed to load order")
        setIsActive(false)
      } finally {
        setLoading(false)
      }
    },
    [loadClients, hydrate],
  )

  const reload = useCallback(async () => {
    if (orderId) await openEdit(orderId)
  }, [orderId, openEdit])

  const close = useCallback(() => {
    setIsActive(false)
    reset()
  }, [reset])

  // Close the builder and tell the page a save/transition landed (refresh
  // list + jump to Orders tab).
  const notifySaved = useCallback(() => {
    close()
    onSaved?.()
  }, [close, onSaved])

  // Only drafts are internally editable (spec ownership model).
  const readOnly = mode === "edit" && !isOrderEditable(status)

  const setClientId = useCallback(
    (id: string) => {
      setClientIdState(id)
      const opt = clientOptions.find((o) => o.id === id)
      setClientEmail(opt?.email ?? null)
    },
    [clientOptions],
  )

  const addProduct = useCallback((p: AddableProduct, qty: number) => {
    const quantity = Math.max(1, Math.trunc(qty) || 1)
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], quantity: next[i].quantity + quantity }
        return next
      }
      return [
        ...prev,
        { productId: p.id, productName: p.name, unitPrice: p.price ?? 0, quantity },
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
          ? { ...l, unitPrice: Math.max(0, Number.isFinite(price) ? price : 0) }
          : l,
      ),
    )
  }, [])

  const removeLine = useCallback((productId: string) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId))
  }, [])

  const total = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)

  // Save the draft content. Returns the order id (existing or freshly created)
  // or null on failure. Promotes a new order into edit mode so subsequent
  // transitions target the saved row.
  const persist = useCallback(async (): Promise<string | null> => {
    if (!clientId) {
      toast.error("Select a client first")
      return null
    }
    setSaving(true)
    try {
      const items = lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      }))
      const payload = { clientId, description, currency, items }
      if (mode === "create") {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          toast.error(e.error || "Failed to save order")
          return null
        }
        const data = await res.json()
        setMode("edit")
        setOrderId(data.id)
        return data.id as string
      }
      const res = await fetch("/api/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, ...payload }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        toast.error(e.error || "Failed to save order")
        return null
      }
      return orderId
    } catch {
      toast.error("Failed to save order")
      return null
    } finally {
      setSaving(false)
    }
  }, [clientId, description, currency, lines, mode, orderId])

  const saveDraft = useCallback(async () => {
    const id = await persist()
    if (id) {
      toast.success("Draft saved")
      close()
      onSaved?.()
    }
  }, [persist, close, onSaved])

  // Status transition via the link endpoint (mint/revoke lifecycle).
  const linkAction = useCallback(
    async (action: "pullback" | "cancel" | "finalize") => {
      if (!orderId) return false
      setSaving(true)
      try {
        const res = await fetch(`/api/orders/${orderId}/link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          toast.error(e.error || "Action failed")
          return false
        }
        return true
      } catch {
        toast.error("Action failed")
        return false
      } finally {
        setSaving(false)
      }
    },
    [orderId],
  )

  // Pull an awaiting_client / cancelled order back to draft (revokes the live
  // link) and re-open it editable.
  const pullBackToDraft = useCallback(async () => {
    if (await linkAction("pullback")) {
      toast.success("Order is a draft again — the previous link no longer works")
      await reload()
    }
  }, [linkAction, reload])

  const cancelOrder = useCallback(async () => {
    if (mode !== "edit" || !orderId) {
      close() // nothing persisted yet — just discard
      return
    }
    if (await linkAction("cancel")) {
      toast.success("Order cancelled")
      close()
      onSaved?.()
    }
  }, [mode, orderId, linkAction, close, onSaved])

  // confirmed → finalized (internal terminal state). For now a pure status
  // change — accounting hand-off is a later step.
  const finalizeOrder = useCallback(async () => {
    if (await linkAction("finalize")) {
      toast.success("Order finalized")
      close()
      onSaved?.()
    }
  }, [linkAction, close, onSaved])

  return {
    isActive,
    mode,
    orderId,
    status,
    readOnly,
    loading,
    saving,
    clientId,
    clientEmail,
    description,
    currency,
    lines,
    total,
    link,
    clientOptions,
    openNew,
    openEdit,
    reload,
    close,
    notifySaved,
    persist,
    setClientId,
    setDescription,
    addProduct,
    setQuantity,
    setUnitPrice,
    removeLine,
    saveDraft,
    pullBackToDraft,
    cancelOrder,
    finalizeOrder,
  }
}

// ── Add-to-order popover (rendered per catalog row) ──────────────────
// `defaultQty` prefills the quantity field — the order-from-request wizard
// passes the parsed quantity for the current step so explicit-line adds land
// at the right count without retyping.
export function AddToOrderButton({
  onAdd,
  disabled,
  defaultQty = 1,
}: {
  onAdd: (qty: number) => void
  disabled?: boolean
  defaultQty?: number
}) {
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(String(defaultQty))

  // Keep the field in sync when the wizard advances to a step with a
  // different parsed quantity (the button instances persist across rows).
  useEffect(() => {
    setQty(String(defaultQty))
  }, [defaultQty])

  const commit = () => {
    const n = Math.max(1, Math.trunc(Number(qty)) || 1)
    onAdd(n)
    setOpen(false)
    setQty(String(defaultQty))
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
        <div className="text-xs font-medium text-muted-foreground">Quantity</div>
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

// ── Send / resend / reopen dialog: collect recipient email, mint, show link ──
function SendLinkDialog({
  orderId,
  sendMode,
  defaultEmail,
  onClose,
  onSent,
}: {
  orderId: string
  sendMode: SendMode
  defaultEmail: string
  onClose: () => void
  onSent: () => void
}) {
  const [email, setEmail] = useState(defaultEmail)
  const [sending, setSending] = useState(false)
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  const title =
    sendMode === "send"
      ? "Send order to client"
      : sendMode === "resend"
        ? "Re-send a new link"
        : "Reopen order to client"

  const submit = async () => {
    if (!isValidEmail(email)) {
      toast.error("Enter a valid recipient email")
      return
    }
    setSending(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: sendMode, recipientEmail: email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Failed to create the link")
        return
      }
      setLinkUrl(data.link.url)
      setExpiresAt(data.link.expiresAt)
    } catch {
      toast.error("Failed to create the link")
    } finally {
      setSending(false)
    }
  }

  const copy = async () => {
    if (!linkUrl) return
    try {
      await navigator.clipboard.writeText(linkUrl)
      toast.success("Link copied")
    } catch {
      toast.error("Couldn't copy — select and copy manually")
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {linkUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The order is now awaiting client confirmation. Copy this link and
              send it to the client — it won’t be shown again.
              {expiresAt && (
                <>
                  {" "}
                  It expires on{" "}
                  <span className="font-medium">
                    {formatOrderDate(expiresAt)}
                  </span>
                  .
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={linkUrl} className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={copy}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={onSent}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Recipient email
              </span>
              <Input
                type="email"
                placeholder="client@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Defaults to the client’s email. The order can’t be sent without a
                valid address.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={sending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={sending}>
                {sending ? (
                  <Loader className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1" />
                )}
                Create link
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Link metadata strip shown for a sent (awaiting_client) order.
function LinkMetaStrip({ link }: { link: OrderLinkMeta | null }) {
  if (!link) return null
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
      <div className="flex items-center gap-2 font-medium">
        <Link2 className="h-4 w-4" />
        Client link {link.status === "active" ? "active" : link.status}
      </div>
      <div className="text-muted-foreground text-xs space-y-0.5">
        {link.recipientEmail && <div>Sent to {link.recipientEmail}</div>}
        <div>Expires {formatOrderDate(link.expiresAt)}</div>
        <div>
          {link.lastAccessedAt
            ? `Client last opened ${formatOrderDate(link.lastAccessedAt)}`
            : "Client hasn’t opened it yet"}
        </div>
      </div>
    </div>
  )
}

// ── Sticky order panel (rendered atop the Catalog tab while active) ───
export function OrderBuilderPanel({ builder }: { builder: OrderBuilder }) {
  const [sendDialog, setSendDialog] = useState<{
    orderId: string
    mode: SendMode
    email: string
  } | null>(null)

  if (!builder.isActive) return null

  const {
    mode,
    status,
    readOnly,
    loading,
    saving,
    clientId,
    clientEmail,
    description,
    currency,
    lines,
    total,
    link,
    clientOptions,
  } = builder

  const title =
    mode === "create" ? "New order" : readOnly ? "Order" : "Edit order"

  // Save the draft (to get/keep an id), then open the send dialog.
  const beginSend = async (sendMode: SendMode) => {
    if (sendMode === "send" && lines.length === 0) {
      toast.error("Add at least one product first")
      return
    }
    let id = builder.orderId
    if (sendMode === "send") {
      id = await builder.persist()
    }
    if (!id) return
    const email =
      (sendMode === "resend" ? link?.recipientEmail : null) ?? clientEmail ?? ""
    setSendDialog({ orderId: id, mode: sendMode, email })
  }

  return (
    <>
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
              {status === "awaiting_client" && <LinkMetaStrip link={link} />}

              {/* Core attributes. */}
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
                          {readOnly
                            ? "No products on this order."
                            : "No products yet — search the catalog below and click “Add to order”."}
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
                            {formatOrderAmount(l.unitPrice * l.quantity, currency)}
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
                  {/* Draft (create or edit): full editing + send. */}
                  {!readOnly && (
                    <>
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
                        onClick={() => beginSend("send")}
                        disabled={saving}
                      >
                        <Send className="h-4 w-4 mr-1" />
                        Send to client
                      </Button>
                    </>
                  )}

                  {/* Sent: read-only + link management. */}
                  {readOnly && status === "awaiting_client" && (
                    <>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={builder.cancelOrder}
                        disabled={saving}
                      >
                        <Ban className="h-4 w-4 mr-1" />
                        Cancel order
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={builder.pullBackToDraft}
                        disabled={saving}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Pull back to draft
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => beginSend("resend")}
                        disabled={saving}
                      >
                        <Send className="h-4 w-4 mr-1" />
                        Re-send link
                      </Button>
                    </>
                  )}

                  {/* Confirmed / finalized: reopen to client, finalize, close. */}
                  {readOnly &&
                    (status === "confirmed" || status === "finalized") && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => beginSend("reopen")}
                          disabled={saving}
                        >
                          <Send className="h-4 w-4 mr-1" />
                          Reopen to client
                        </Button>
                        {status === "confirmed" && (
                          <Button
                            size="sm"
                            onClick={builder.finalizeOrder}
                            disabled={saving}
                          >
                            <PackageCheck className="h-4 w-4 mr-1" />
                            Finalize the order
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={builder.close}>
                          Close
                        </Button>
                      </>
                    )}

                  {/* Cancelled: reopen as draft or close. */}
                  {readOnly && status === "cancelled" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={builder.pullBackToDraft}
                        disabled={saving}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Reopen as draft
                      </Button>
                      <Button variant="outline" size="sm" onClick={builder.close}>
                        Close
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {sendDialog && (
        <SendLinkDialog
          orderId={sendDialog.orderId}
          sendMode={sendDialog.mode}
          defaultEmail={sendDialog.email}
          onClose={() => setSendDialog(null)}
          onSent={() => {
            setSendDialog(null)
            builder.notifySaved()
          }}
        />
      )}
    </>
  )
}
