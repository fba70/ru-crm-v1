"use client"

import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, ImageOff, Loader } from "lucide-react"
import type { GuestProductDetail } from "@/server/order-links"
import type { EntityStatus } from "@/db/schema"
import { getGuestProductDetailAction } from "./actions"

// UI display labels for the entity status badge (DB enum values stay English).
const STATUS_LABEL: Record<EntityStatus, string> = {
  active: "Активный",
  suspended: "Приостановлен",
  initial: "Новый",
  deleted: "Удалён",
}

// Humanize a DB field name into a readable label: snake/camel → spaced,
// first letter capitalised. e.g. "country_name" → "Country name". Generic on
// purpose so new catalog attributes get a sensible label without a map.
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// Render a JSON metadata blob as label/value rows, skipping empty values.
function metadataEntries(
  meta: Record<string, unknown>,
): { label: string; value: string }[] {
  return Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => ({ label: humanizeKey(k), value: String(v) }))
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-1.5 border-b border-muted/60 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm wrap-break-word whitespace-pre-wrap">{value}</span>
    </div>
  )
}

function Group({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
        {title}
      </h3>
      <div className="rounded-md border bg-muted/30 px-3 py-1">{children}</div>
    </section>
  )
}

function formatPrice(price: number | null): string {
  if (price === null) return "—"
  return price.toLocaleString("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

// Guest-facing product card. Same layout as the operator catalog's
// `ProductDetailDialog` but WITHOUT any stock section — the client must not
// see our inventory. Data comes from a token-scoped server action (not the
// auth-gated `/api/products/[id]`), so the guest can only open products that
// are already line items on their order.
export function GuestProductDialog({
  token,
  productId,
  trigger,
}: {
  token: string
  productId: string
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [product, setProduct] = useState<GuestProductDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One-time fetch guard; a ref so it stays out of the effect deps.
  const fetchedRef = useRef(false)

  const loading = open && product === null && error === null

  useEffect(() => {
    if (!open || fetchedRef.current) return
    let cancelled = false
    getGuestProductDetailAction(token, productId)
      .then((data) => {
        if (cancelled) return
        if (!data) {
          setError("Не удалось загрузить карточку товара")
          return
        }
        setProduct(data)
        fetchedRef.current = true
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить карточку товара")
      })
    return () => {
      cancelled = true
    }
  }, [open, token, productId])

  const additional = product ? metadataEntries(product.additionalMetadata) : []
  const accounting = product ? metadataEntries(product.accountingMetadata) : []

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reopening after a failed load: clear the error so the effect retries
        // (fetchedRef stays false on error, so the retry actually re-runs).
        if (next && !fetchedRef.current) setError(null)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-212 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">
            {product?.name ?? "Карточка товара"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-destructive">
            {error}
          </div>
        ) : product ? (
          <div className="space-y-5">
            <div className="flex gap-4 items-stretch">
              <div className="shrink-0 w-36 relative">
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="absolute inset-0 h-full w-full object-contain bg-muted"
                  />
                ) : (
                  <div className="absolute inset-0 h-full w-full bg-muted flex items-center justify-center">
                    <ImageOff className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-5">
                <Group title="Основное">
                  <Field label="Категория" value={product.category ?? "—"} />
                  <Field label="Цена" value={formatPrice(product.price)} />
                  <Field
                    label="Страница на сайте"
                    value={
                      product.webPageUrl ? (
                        <a
                          href={product.webPageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-orange-400 hover:underline inline-flex items-center gap-1"
                        >
                          Открыть <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <Field
                    label="Статус"
                    value={
                      <Badge variant="secondary">
                        {STATUS_LABEL[product.status] ?? product.status}
                      </Badge>
                    }
                  />
                </Group>

                {accounting.length > 0 && (
                  <Group title="Учёт">
                    {accounting.map((e) => (
                      <Field key={e.label} label={e.label} value={e.value} />
                    ))}
                  </Group>
                )}
              </div>
            </div>

            {additional.length > 0 && (
              <Group title="Дополнительные атрибуты">
                {additional.map((e) => (
                  <Field key={e.label} label={e.label} value={e.value} />
                ))}
              </Group>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
