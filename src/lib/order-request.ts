// Shared types for the LLM-assisted "order from request" flow.
//
// A pasted client request is split by the LLM into intent items. A
// `discovery`-mode item carries catalog filters (this shape); an
// `explicit`-mode item leaves these empty and uses a transliterated
// `searchPhrase` instead. Kept here (no DB/server imports) so `db/schema.ts`
// can `$type` the jsonb column without a circular dependency.

// Filters an LLM-parsed discovery request maps onto the product catalog.
// Keys mirror the catalog's filterable attributes; the attribute values are
// Russian + UPPERCASE (as stored in `product.additional_metadata`), `category`
// is Russian (e.g. "Красное", "Виски"), and the price range is numeric RUB.
// All optional — the LLM emits only what the text actually implies.
export type OrderRequestItemFilters = {
  category?: string
  type?: string
  color?: string
  sugar?: string
  year?: string
  aging?: string
  bottleVolume?: string
  countryName?: string
  appelacion?: string
  rating?: string
  priceMin?: number
  priceMax?: number
}

// Empty-vs-set helper: true when at least one filter is populated.
export function hasAnyFilter(f: OrderRequestItemFilters | null | undefined): boolean {
  if (!f) return false
  return Object.values(f).some((v) => v !== undefined && v !== null && v !== "")
}

// Best-effort integer quantity from the raw hint text ("6", "6 бут", "15 л").
// Returns 1 when no usable count is present (e.g. a bare bottle size like
// "0,7") so the add-to-order field has a sane default the rep can adjust.
export function parseQtyHint(hint: string | null | undefined): number {
  if (!hint) return 1
  const m = hint.match(/\d+/)
  if (!m) return 1
  const n = parseInt(m[0], 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}
