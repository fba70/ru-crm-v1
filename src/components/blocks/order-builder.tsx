"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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

// Russian plural picker: forms = [one, few, many] e.g. ["позиция","позиции",
// "позиций"]. Handles the teen exception and the 1 / 2–4 / 0,5–20 rules.
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

// One product line being built client-side. `unitPrice` + `quantity` are
// editable; position price (unit × qty) + the order total are derived.
export type DraftLine = {
  productId: string
  productName: string
  unitPrice: number
  quantity: number
  // Current catalog stock (null = unknown). Drives the "only products in
  // stock" guard; null is treated as unconstrained.
  stock: number | null
}

export type AddableProduct = {
  id: string
  name: string
  price: number | null
  stock?: number | null
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
  // When on, products without enough catalog stock can't be added and line
  // quantities are capped at available stock. Per-session UI guard (not saved).
  const [stockOnly, setStockOnly] = useState(true)

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
    setStockOnly(true)
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
    setStockOnly(true)
    setLines(
      o.items.map((i) => ({
        productId: i.productId,
        productName: i.productName ?? i.productId,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        stock: i.productStock,
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
          toast.error("Не удалось загрузить заказ")
          setIsActive(false)
          return
        }
        const { order } = (await res.json()) as { order: OrderDetail }
        hydrate(order)
      } catch {
        toast.error("Не удалось загрузить заказ")
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

  const addProduct = useCallback(
    (p: AddableProduct, qty: number) => {
      const quantity = Math.max(1, Math.trunc(qty) || 1)
      const stock = p.stock ?? null
      // "Only products in stock" guard: block products with no stock and adds
      // that would push the line over available stock.
      if (stockOnly) {
        if (stock === null || stock <= 0) {
          toast.error(`«${p.name}» — нет в наличии`)
          return
        }
        const existing =
          lines.find((l) => l.productId === p.id)?.quantity ?? 0
        if (existing + quantity > stock) {
          toast.error(
            `В наличии только ${stock} шт. «${p.name}»${existing ? ` (${existing} уже в заказе)` : ""}`,
          )
          return
        }
      }
      setLines((prev) => {
        const i = prev.findIndex((l) => l.productId === p.id)
        if (i >= 0) {
          const next = [...prev]
          next[i] = { ...next[i], quantity: next[i].quantity + quantity, stock }
          return next
        }
        return [
          ...prev,
          {
            productId: p.id,
            productName: p.name,
            unitPrice: p.price ?? 0,
            quantity,
            stock,
          },
        ]
      })
    },
    [stockOnly, lines],
  )

  const setQuantity = useCallback(
    (productId: string, qty: number) => {
      setLines((prev) =>
        prev.map((l) => {
          if (l.productId !== productId) return l
          let q = Math.max(1, Math.trunc(qty) || 1)
          // Cap at available stock when the guard is on (null stock = unknown,
          // left unconstrained).
          if (stockOnly && l.stock !== null && q > l.stock) {
            q = Math.max(1, l.stock)
            toast.error(`В наличии только ${l.stock} шт. «${l.productName}»`)
          }
          return { ...l, quantity: q }
        }),
      )
    },
    [stockOnly],
  )

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
      toast.error("Сначала выберите клиента")
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
          toast.error(e.error || "Не удалось сохранить заказ")
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
        toast.error(e.error || "Не удалось сохранить заказ")
        return null
      }
      return orderId
    } catch {
      toast.error("Не удалось сохранить заказ")
      return null
    } finally {
      setSaving(false)
    }
  }, [clientId, description, currency, lines, mode, orderId])

  const saveDraft = useCallback(async () => {
    const id = await persist()
    if (id) {
      toast.success("Черновик сохранён")
      close()
      onSaved?.()
    }
  }, [persist, close, onSaved])

  // Save content edits on a confirmed order without leaving the panel (so the
  // user can keep adjusting, then finalize). Re-hydrates from the server.
  const saveChanges = useCallback(async () => {
    const id = await persist()
    if (id) {
      toast.success("Изменения сохранены")
      await reload()
    }
  }, [persist, reload])

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
          toast.error(e.error || "Не удалось выполнить действие")
          return false
        }
        return true
      } catch {
        toast.error("Не удалось выполнить действие")
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
      toast.success("Заказ снова черновик — предыдущая ссылка больше не работает")
      await reload()
    }
  }, [linkAction, reload])

  const cancelOrder = useCallback(async () => {
    if (mode !== "edit" || !orderId) {
      close() // nothing persisted yet — just discard
      return
    }
    if (await linkAction("cancel")) {
      toast.success("Заказ отменён")
      close()
      onSaved?.()
    }
  }, [mode, orderId, linkAction, close, onSaved])

  // confirmed → finalized (internal terminal state). Persists any pending
  // content edits first so the finalized order reflects the user's last
  // adjustments. For now a pure status change — accounting hand-off is later.
  const finalizeOrder = useCallback(async () => {
    const id = await persist()
    if (!id) return
    if (await linkAction("finalize")) {
      toast.success("Заказ оформлен")
      close()
      onSaved?.()
    }
  }, [persist, linkAction, close, onSaved])

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
    stockOnly,
    setStockOnly,
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
    saveChanges,
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
          Добавить
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 space-y-2" align="end">
        <div className="text-xs font-medium text-muted-foreground">Количество</div>
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
          Добавить в заказ
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
      ? "Отправить заказ клиенту"
      : sendMode === "resend"
        ? "Отправить новую ссылку"
        : "Вернуть заказ клиенту"

  const submit = async () => {
    if (!isValidEmail(email)) {
      toast.error("Введите корректный email получателя")
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
        toast.error(data.error || "Не удалось создать ссылку")
        return
      }
      setLinkUrl(data.link.url)
      setExpiresAt(data.link.expiresAt)
    } catch {
      toast.error("Не удалось создать ссылку")
    } finally {
      setSending(false)
    }
  }

  const copy = async () => {
    if (!linkUrl) return
    try {
      await navigator.clipboard.writeText(linkUrl)
      toast.success("Ссылка скопирована")
    } catch {
      toast.error("Не удалось скопировать — выделите и скопируйте вручную")
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
              Заказ ожидает подтверждения клиента. Скопируйте эту ссылку и
              отправьте её клиенту — повторно она не отобразится.
              {expiresAt && (
                <>
                  {" "}
                  Действует до{" "}
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
              <Button onClick={onSent}>Готово</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Email получателя
              </span>
              <Input
                type="email"
                placeholder="client@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                По умолчанию — email клиента. Заказ нельзя отправить без
                корректного адреса.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={sending}>
                Отмена
              </Button>
              <Button onClick={submit} disabled={sending}>
                {sending ? (
                  <Loader className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1" />
                )}
                Создать ссылку
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
        Ссылка для клиента{" "}
        {link.status === "active" ? "активна" : link.status}
      </div>
      <div className="text-muted-foreground text-xs space-y-0.5">
        {link.recipientEmail && <div>Отправлено: {link.recipientEmail}</div>}
        <div>Действует до {formatOrderDate(link.expiresAt)}</div>
        <div>
          {link.lastAccessedAt
            ? `Клиент открывал ${formatOrderDate(link.lastAccessedAt)}`
            : "Клиент ещё не открывал"}
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
    stockOnly,
  } = builder

  const title =
    mode === "create"
      ? "Новый заказ"
      : readOnly
        ? "Заказ"
        : "Редактирование заказа"

  // Save (to get/keep an id), then open the send dialog. Persist first whenever
  // the panel is editable (draft → send; confirmed → reopen) so the client
  // receives the latest content; a read-only reopen (finalized) skips persist.
  const beginSend = async (sendMode: SendMode) => {
    if (sendMode === "send" && lines.length === 0) {
      toast.error("Сначала добавьте хотя бы один товар")
      return
    }
    let id = builder.orderId
    if (!readOnly && (sendMode === "send" || sendMode === "reopen")) {
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
            aria-label="Закрыть заказ"
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
                  <span className="text-xs text-muted-foreground">Клиент *</span>
                  <Select
                    value={clientId ?? ""}
                    onValueChange={(v) => builder.setClientId(v)}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Выберите клиента" />
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
                    Описание
                  </span>
                  <Textarea
                    rows={1}
                    className="min-h-9"
                    placeholder="Необязательная заметка к заказу"
                    value={description}
                    onChange={(e) => builder.setDescription(e.target.value)}
                    disabled={readOnly}
                  />
                </div>
              </div>

              {/* Order-formation guard: block out-of-stock adds. */}
              {!readOnly && (
                <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
                  <Checkbox
                    checked={stockOnly}
                    onCheckedChange={(v) => builder.setStockOnly(v === true)}
                  />
                  Только товары в наличии
                </label>
              )}

              {/* Line items. */}
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Товар</TableHead>
                      <TableHead className="w-32 text-right">
                        Цена за ед.
                      </TableHead>
                      <TableHead className="w-24 text-right">Кол-во</TableHead>
                      <TableHead className="w-32 text-right">Сумма</TableHead>
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
                            ? "В заказе нет товаров."
                            : "Пока нет товаров — найдите их в каталоге ниже и нажмите «Добавить в заказ»."}
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
                                aria-label="Удалить позицию"
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
                  <span className="text-muted-foreground">Итого: </span>
                  <span className="font-semibold tabular-nums">
                    {formatOrderAmount(total, currency)}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {lines.length}{" "}
                    {plural(lines.length, ["позиция", "позиции", "позиций"])}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Draft (create or edit): full editing + send. */}
                  {!readOnly && status !== "confirmed" && (
                    <>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={builder.cancelOrder}
                        disabled={saving}
                      >
                        <Ban className="h-4 w-4 mr-1" />
                        {mode === "edit" ? "Отменить заказ" : "Отменить"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={builder.saveDraft}
                        disabled={saving}
                      >
                        <Save className="h-4 w-4 mr-1" />
                        {mode === "create" ? "Сохранить черновик" : "Сохранить"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => beginSend("send")}
                        disabled={saving}
                      >
                        <Send className="h-4 w-4 mr-1" />
                        Отправить клиенту
                      </Button>
                    </>
                  )}

                  {/* Confirmed: client returned it — editable before finalize.
                      Save edits (stay open), send back, or finalize. */}
                  {!readOnly && status === "confirmed" && (
                    <>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={builder.cancelOrder}
                        disabled={saving}
                      >
                        <Ban className="h-4 w-4 mr-1" />
                        Отменить заказ
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => beginSend("reopen")}
                        disabled={saving}
                      >
                        <Send className="h-4 w-4 mr-1" />
                        Вернуть клиенту
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={builder.saveChanges}
                        disabled={saving}
                      >
                        <Save className="h-4 w-4 mr-1" />
                        Сохранить изменения
                      </Button>
                      <Button
                        size="sm"
                        onClick={builder.finalizeOrder}
                        disabled={saving}
                      >
                        <PackageCheck className="h-4 w-4 mr-1" />
                        Оформить заказ
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
                        Отменить заказ
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={builder.pullBackToDraft}
                        disabled={saving}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Вернуть в черновик
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => beginSend("resend")}
                        disabled={saving}
                      >
                        <Send className="h-4 w-4 mr-1" />
                        Отправить ссылку повторно
                      </Button>
                    </>
                  )}

                  {/* Finalized: read-only — reopen to client or close. */}
                  {readOnly && status === "finalized" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => beginSend("reopen")}
                        disabled={saving}
                      >
                        <Send className="h-4 w-4 mr-1" />
                        Вернуть клиенту
                      </Button>
                      <Button variant="outline" size="sm" onClick={builder.close}>
                        Закрыть
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
                        Открыть как черновик
                      </Button>
                      <Button variant="outline" size="sm" onClick={builder.close}>
                        Закрыть
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
