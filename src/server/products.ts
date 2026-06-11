"use server"

import { db } from "@/db/drizzle"
import { product, type EntityStatus } from "@/db/schema"
import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"

// One per-location stock entry (spreadsheet cols AB-AP).
export type ProductStockLocation = {
  key: string
  label: string
  count: number | null
}

// Lightweight shape for the table listing — ONLY the columns the table
// renders. The heavy JSON groups (accounting / additional / stock
// metadata) are deliberately NOT included here so the list payload stays
// small even at large page sizes; the detail dialog fetches them on
// demand via `getProduct` (see `ProductDetail`).
export type ProductRow = {
  id: string
  name: string
  category: string | null
  webPageUrl: string | null
  // numeric(14,2) comes back from drizzle as a string; the API converts
  // to number for the client.
  price: number | null
  imageUrl: string | null
  totalStock: number | null
  status: EntityStatus
}

// Full product shape for the detail dialog — the main columns plus the
// three JSON metadata groups. Fetched one row at a time, only when the
// preview pop-up opens.
export type ProductDetail = {
  id: string
  name: string
  category: string | null
  webPageUrl: string | null
  price: number | null
  imageUrl: string | null
  totalStock: number | null
  accountingMetadata: Record<string, unknown>
  additionalMetadata: Record<string, unknown>
  stockMetadata: ProductStockLocation[]
  status: EntityStatus
  createdAt: string
  updatedAt: string
}

export type ProductInStock = "in" | "out"

export type ListProductsParams = {
  q?: string
  category?: string
  // Exact-match filters over enumerable additional_metadata attributes.
  type?: string
  color?: string
  sugar?: string
  year?: string
  aging?: string
  bottleVolume?: string
  countryName?: string
  appelacion?: string
  rating?: string
  // Free-text "contains" filter over the long, composite awards string.
  awards?: string
  // Price range over the numeric price column.
  priceMin?: number
  priceMax?: number
  // Stock presence derived from total_stock (in = >0, out = null/≤0).
  inStock?: ProductInStock
  limit?: number
  offset?: number
}

// The enumerable attributes exposed as filter dropdowns, mapped to their
// additional_metadata JSON key. Order drives nothing here — it's the UI's
// concern — but keeping the map in the server module keeps the JSON-key
// spelling in one place for both the WHERE builder and the options query.
const ATTR_FILTER_KEYS = {
  type: "type",
  color: "color",
  sugar: "sugar",
  year: "year",
  aging: "aging",
  bottleVolume: "bottle_volume",
  countryName: "country_name",
  appelacion: "appelacion",
  rating: "rating",
} as const

// Free-text search probes the `name` column plus these `additional_metadata`
// keys by VALUE (`->> 'key' ILIKE …`). Probing named values — rather than
// casting the whole JSON blob to text — keeps a query like "description" or
// "color" from matching every row just because those strings appear as JSON
// *keys*. Add a key here to make its text searchable. Order is irrelevant.
const SEARCH_TEXT_KEYS = [
  "taste",
  "flavour",
  "gastronomy",
  "color_details",
  "description",
  "color",
  "country_name",
  "region",
  "appelacion",
  "type",
  "vendor",
] as const

export type ListProductsResult = {
  rows: ProductRow[]
  total: number
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

// Server-side paginated + searched product listing. The catalog is large
// (tens of thousands of rows), so the page never pulls the full set —
// every fetch is one page with the current search applied in SQL.
//
// Search is intentionally broad-but-simple for now: a single ILIKE term
// OR'd across the main columns, the accounting codes, and the full
// additional-metadata blob cast to text (covers description / country /
// region / taste / etc.). Precision tuning is a deliberate later step.
export async function listProducts(
  params: ListProductsParams = {},
): Promise<ListProductsResult> {
  const { activeOrgId } = await requireOrgContext()

  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100)
  const offset = Math.max(params.offset ?? 0, 0)
  const q = params.q?.trim()
  const category = params.category?.trim()

  // Exact-match on an additional_metadata attribute (e.g. type = "ВИНО").
  const attrEq = (jsonKey: string, val?: string) => {
    const v = val?.trim()
    return v && v.length > 0
      ? sql`${product.additionalMetadata} ->> ${jsonKey} = ${v}`
      : undefined
  }
  const awards = params.awards?.trim()

  const where = and(
    eq(product.organizationId, activeOrgId),
    eq(product.status, "active"),
    category && category.length > 0
      ? eq(product.category, category)
      : undefined,
    q && q.length > 0
      ? or(
          ilike(product.name, `%${q}%`),
          ilike(product.category, `%${q}%`),
          // Accounting ids (code / barCode) — keep the blob match so a
          // barcode/code lookup still works.
          sql`${product.accountingMetadata}::text ILIKE ${`%${q}%`}`,
          // Named text fields, matched by VALUE (not the JSON key names).
          ...SEARCH_TEXT_KEYS.map(
            (k) =>
              sql`${product.additionalMetadata} ->> ${k} ILIKE ${`%${q}%`}`,
          ),
        )
      : undefined,
    attrEq(ATTR_FILTER_KEYS.type, params.type),
    attrEq(ATTR_FILTER_KEYS.color, params.color),
    attrEq(ATTR_FILTER_KEYS.sugar, params.sugar),
    attrEq(ATTR_FILTER_KEYS.year, params.year),
    attrEq(ATTR_FILTER_KEYS.aging, params.aging),
    attrEq(ATTR_FILTER_KEYS.bottleVolume, params.bottleVolume),
    attrEq(ATTR_FILTER_KEYS.countryName, params.countryName),
    attrEq(ATTR_FILTER_KEYS.appelacion, params.appelacion),
    attrEq(ATTR_FILTER_KEYS.rating, params.rating),
    awards && awards.length > 0
      ? sql`${product.additionalMetadata} ->> 'awards' ILIKE ${`%${awards}%`}`
      : undefined,
    params.priceMin != null && Number.isFinite(params.priceMin)
      ? sql`${product.price} >= ${params.priceMin}`
      : undefined,
    params.priceMax != null && Number.isFinite(params.priceMax)
      ? sql`${product.price} <= ${params.priceMax}`
      : undefined,
    params.inStock === "in"
      ? sql`${product.totalStock} > 0`
      : params.inStock === "out"
        ? sql`(${product.totalStock} IS NULL OR ${product.totalStock} <= 0)`
        : undefined,
  )

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: product.id,
        name: product.name,
        category: product.category,
        webPageUrl: product.webPageUrl,
        price: product.price,
        imageUrl: product.imageUrl,
        totalStock: product.totalStock,
        status: product.status,
      })
      .from(product)
      .where(where)
      .orderBy(asc(product.name))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(product).where(where),
  ])

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      webPageUrl: r.webPageUrl,
      price: r.price === null ? null : Number(r.price),
      imageUrl: r.imageUrl,
      totalStock: r.totalStock,
      status: r.status,
    })),
    total: totalRows[0]?.n ?? 0,
  }
}

// Full single-product fetch for the detail pop-up — org-scoped. Returns
// null when the id doesn't exist or belongs to another org (the route
// translates that to 404). Loaded lazily, one row at a time, only when
// the preview dialog opens.
export async function getProduct(id: string): Promise<ProductDetail | null> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await db
    .select()
    .from(product)
    .where(and(eq(product.id, id), eq(product.organizationId, activeOrgId)))
    .limit(1)

  const r = rows[0]
  if (!r) return null

  return {
    id: r.id,
    name: r.name,
    category: r.category,
    webPageUrl: r.webPageUrl,
    price: r.price === null ? null : Number(r.price),
    imageUrl: r.imageUrl,
    totalStock: r.totalStock,
    accountingMetadata:
      (r.accountingMetadata as Record<string, unknown> | null) ?? {},
    additionalMetadata:
      (r.additionalMetadata as Record<string, unknown> | null) ?? {},
    stockMetadata: Array.isArray(r.stockMetadata)
      ? (r.stockMetadata as ProductStockLocation[])
      : [],
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

// Distinct non-null categories for the active org's active products,
// alphabetically sorted — powers the category filter dropdown. Small
// cardinality (catalog sections), so a plain DISTINCT is fine.
export async function listProductCategories(): Promise<string[]> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await db
    .selectDistinct({ category: product.category })
    .from(product)
    .where(
      and(
        eq(product.organizationId, activeOrgId),
        eq(product.status, "active"),
      ),
    )
    .orderBy(asc(product.category))

  return rows
    .map((r) => r.category)
    .filter((c): c is string => c !== null && c.trim().length > 0)
}

// Distinct dropdown options for each enumerable additional_metadata
// attribute, scoped to the org's active products. Numeric-valued keys sort
// numerically (year/rating high→low, aging/volume low→high); the rest sort
// alphabetically (RU locale). `awards` is intentionally NOT here — its
// values are long composite strings, so the UI exposes it as a free-text
// "contains" input rather than a dropdown. Fetched once on mount; a handful
// of distinct scans over an indexed org/status slice is cheap.
export type ProductFilterOptions = {
  type: string[]
  color: string[]
  sugar: string[]
  year: string[]
  aging: string[]
  bottleVolume: string[]
  countryName: string[]
  appelacion: string[]
  rating: string[]
}

export async function listProductFilterOptions(): Promise<ProductFilterOptions> {
  const { activeOrgId } = await requireOrgContext()

  const distinct = async (jsonKey: string): Promise<string[]> => {
    const rows = await db
      .selectDistinct({
        v: sql<string>`${product.additionalMetadata} ->> ${jsonKey}`,
      })
      .from(product)
      .where(
        and(
          eq(product.organizationId, activeOrgId),
          eq(product.status, "active"),
          sql`COALESCE(TRIM(${product.additionalMetadata} ->> ${jsonKey}), '') <> ''`,
        ),
      )
    return rows.map((r) => r.v)
  }

  const numAsc = (a: string, b: string) => Number(a) - Number(b)
  const numDesc = (a: string, b: string) => Number(b) - Number(a)
  const alpha = (a: string, b: string) => a.localeCompare(b, "ru")

  const [
    type,
    color,
    sugar,
    year,
    aging,
    bottleVolume,
    countryName,
    appelacion,
    rating,
  ] = await Promise.all([
    distinct(ATTR_FILTER_KEYS.type),
    distinct(ATTR_FILTER_KEYS.color),
    distinct(ATTR_FILTER_KEYS.sugar),
    distinct(ATTR_FILTER_KEYS.year),
    distinct(ATTR_FILTER_KEYS.aging),
    distinct(ATTR_FILTER_KEYS.bottleVolume),
    distinct(ATTR_FILTER_KEYS.countryName),
    distinct(ATTR_FILTER_KEYS.appelacion),
    distinct(ATTR_FILTER_KEYS.rating),
  ])

  return {
    type: type.sort(alpha),
    color: color.sort(alpha),
    sugar: sugar.sort(alpha),
    year: year.sort(numDesc),
    aging: aging.sort(numAsc),
    bottleVolume: bottleVolume.sort(numAsc),
    countryName: countryName.sort(alpha),
    appelacion: appelacion.sort(alpha),
    rating: rating.sort(numDesc),
  }
}
