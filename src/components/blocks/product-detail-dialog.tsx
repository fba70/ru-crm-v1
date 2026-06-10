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
import type { ProductDetail } from "@/app/api/products/[id]/route"

// Humanize a DB field name into a readable label: snake/camel → spaced,
// first letter capitalised. e.g. "country_name" → "Country name",
// "barCode" → "Bar code". Generic on purpose so new catalog columns get
// a sensible label without a hardcoded map.
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
  // RUB currency; drop the fractional part for whole-ruble prices, keep
  // up to 2 digits when the price actually has kopecks (e.g. 9,99 ₽).
  return price.toLocaleString("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export function ProductDetailDialog({
  productId,
  trigger,
}: {
  productId: string
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Guards a one-time fetch. A ref (not state) so it stays out of the
  // effect deps — otherwise a state flip would re-run the effect and its
  // cleanup would cancel the in-flight fetch.
  const fetchedRef = useRef(false)

  // Loading is derived, not stored: while the dialog is open and we have
  // neither a result nor an error, the fetch is in flight. Avoids a
  // synchronous setState inside the effect (lint: set-state-in-effect).
  const loading = open && product === null && error === null

  // Fetch the full product only when the dialog opens, and only once per
  // mount (cached in state). Closing keeps the data so a re-open is
  // instant; the heavy JSON never loads for rows the user doesn't inspect.
  useEffect(() => {
    if (!open || fetchedRef.current) return
    let cancelled = false
    fetch(`/api/products/${productId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed to load")
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        setProduct(data.product ?? null)
        fetchedRef.current = true
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load")
      })
    return () => {
      cancelled = true
    }
  }, [open, productId])

  const additional = product ? metadataEntries(product.additionalMetadata) : []
  const accounting = product ? metadataEntries(product.accountingMetadata) : []

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reopening after a failed load: clear the error so the effect
        // retries and the spinner shows again (fetchedRef stays false on
        // error, so the retry actually re-runs).
        if (next && !fetchedRef.current) setError(null)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* ~2/3 of the page container (max-w-7xl ≈ 80rem → ~53rem). */}
      <DialogContent className="sm:max-w-212 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">
            {product?.name ?? "Product details"}
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
            {/* Image + main attributes (spreadsheet cols C-H). The flex row
                stretches both columns to equal height; products are bottles
                (portrait), so the image box is a tall, narrow column that
                matches the Main box height with the image contained inside. */}
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
                <Group title="Main">
                  <Field
                    label="Category"
                    value={product.category ?? "—"}
                  />
                  <Field label="Price" value={formatPrice(product.price)} />
                  <Field
                    label="Total stock"
                    value={product.totalStock ?? "—"}
                  />
                  <Field
                    label="Web page"
                    value={
                      product.webPageUrl ? (
                        <a
                          href={product.webPageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-orange-400 hover:underline inline-flex items-center gap-1"
                        >
                          Open <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <Field
                    label="Status"
                    value={<Badge variant="secondary">{product.status}</Badge>}
                  />
                </Group>

                {/* Accounting IDs (cols A-B) */}
                {accounting.length > 0 && (
                  <Group title="Accounting">
                    {accounting.map((e) => (
                      <Field key={e.label} label={e.label} value={e.value} />
                    ))}
                  </Group>
                )}
              </div>
            </div>

            {/* Additional attributes (cols I-Z + price_range) */}
            {additional.length > 0 && (
              <Group title="Additional attributes">
                {additional.map((e) => (
                  <Field key={e.label} label={e.label} value={e.value} />
                ))}
              </Group>
            )}

            {/* Stock by location (cols AB-AP) — multi-column grid since
                there are many warehouses and each value is short. */}
            {product.stockMetadata.length > 0 && (
              <Group title="Stock by location">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 py-1">
                  {product.stockMetadata.map((loc) => (
                    <div
                      key={loc.key}
                      className="flex items-baseline justify-between gap-2 border-b border-muted/60 py-1.5"
                    >
                      <span className="text-sm text-muted-foreground truncate">
                        {loc.label}
                      </span>
                      <span className="text-sm tabular-nums shrink-0">
                        {loc.count ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              </Group>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
