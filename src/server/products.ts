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
  // Relevance score from the bilingual `terms` search, when terms were
  // supplied. `terms` RANKS (orders) rather than filters, so a zero score
  // means the row is filler shown only because nothing matched — the UI uses
  // this to suppress a misleading "Best match" badge. Undefined when no terms.
  score?: number
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
  // Bilingual ranked search: products score +1 per term that hits, and the
  // listing is filtered to score > 0 and ordered by score desc. Used by the
  // order-from-request wizard to match mixed RU/EN catalog names without
  // depending on a single transliteration or word order. Combinable with the
  // structured filters below (filters narrow; terms rank within).
  terms?: string[]
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

// `additional_metadata` keys probed by the bilingual TERM search. Deliberately
// narrower than SEARCH_TEXT_KEYS — identity/attribute fields only, NOT prose
// (`description`/`taste`/…) — so a token like "Dry" doesn't score every wine
// whose tasting notes say "dry". Term matching targets the product's NAME and
// its defining attributes across both languages.
const TERM_MATCH_KEYS = [
  "type",
  "country_name",
  "color",
  "sugar",
  "vendor",
  "appelacion",
  "region",
  "aging",
] as const

// Min token length kept for term search — drops single chars / stray digits
// that would match half the catalog.
const MIN_TERM_LEN = 2

// Field weights for ranked term search — a hit in the product NAME is a far
// stronger signal of the right product than a hit in a generic attribute, so
// the brand word living in the name dominates a category/country match.
const FIELD_W = { name: 3, category: 2, accounting: 2, attr: 1 } as const

// Per-term distinctiveness weight: rare/long/numeric tokens (brand words,
// proof/age numbers like "135") discriminate far better than short common
// kind-words ("Gin", "Dry", "Вино"), so they should dominate the score.
function termWeight(t: string): number {
  if (/^\d+$/.test(t)) return 2.5
  if (t.length >= 6) return 1.8
  if (t.length >= 4) return 1.3
  return 0.8
}

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

  // Bilingual ranked search: dedupe terms (case-insensitive), drop too-short
  // ones, cap the count, and build a WEIGHTED relevance score. Per term, the
  // best field hit (name > category/accounting > attribute, via GREATEST so a
  // term counts once) is scaled by the term's distinctiveness weight — so a
  // rare brand word in the name dominates a common kind-word in an attribute.
  // Terms RANK, they do NOT filter: ordering is by score desc, then the
  // shorter name (tighter match) as a coverage tie-break. A request item whose
  // terms match nothing (e.g. a transliteration the Latin catalog doesn't
  // carry) therefore still shows the catalog instead of an empty table — the
  // rep refines via the visible search box. (The catalog is in Latin while
  // clients often write Cyrillic, so a hard score>0 filter would routinely
  // blank the table mid-wizard.)
  const uniqueTerms = [
    ...new Map(
      (params.terms ?? [])
        .map((t) => t.trim())
        .filter((t) => t.length >= MIN_TERM_LEN)
        .map((t) => [t.toLowerCase(), t] as const),
    ).values(),
  ].slice(0, 16)
  const hasTerms = uniqueTerms.length > 0

  const termScore = (t: string) => {
    const like = `%${t}%`
    const w = termWeight(t)
    // `w` is a JS float (0.8 / 1.3 / 1.8 / 2.5) sent as an untyped param. In
    // `$param * GREATEST(<int CASEs>)` Postgres resolves `unknown * int4` and
    // tries to cast the literal to INTEGER → "invalid input syntax for type
    // integer: 0.8" (every terms query 500s → empty catalog). Cast to float8
    // so the multiplication stays numeric. (Regression from the ranked-search
    // rewrite in dc63edf — see PHASE2 / git blame.)
    return sql`(${w})::float8 * GREATEST(
      CASE WHEN ${product.name} ILIKE ${like} THEN ${FIELD_W.name} ELSE 0 END,
      CASE WHEN ${product.category} ILIKE ${like} THEN ${FIELD_W.category} ELSE 0 END,
      CASE WHEN ${product.accountingMetadata}::text ILIKE ${like} THEN ${FIELD_W.accounting} ELSE 0 END,
      ${sql.join(
        TERM_MATCH_KEYS.map(
          (k) =>
            sql`CASE WHEN ${product.additionalMetadata} ->> ${k} ILIKE ${like} THEN ${FIELD_W.attr} ELSE 0 END`,
        ),
        sql`, `,
      )}
    )`
  }
  const scoreExpr = hasTerms
    ? sql<number>`(${sql.join(
        uniqueTerms.map((t) => termScore(t)),
        sql` + `,
      )})`
    : null

  const where = and(
    eq(product.organizationId, activeOrgId),
    eq(product.status, "active"),
    // NOTE: terms intentionally do NOT appear here — they rank (orderBy), not
    // filter, so an unmatched term never empties the catalog. See termScore.
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
        // Score is null unless terms were supplied; surfaced so the client can
        // distinguish a real ranked hit from a zero-score filler row.
        score: scoreExpr ?? sql<number | null>`NULL`,
      })
      .from(product)
      .where(where)
      .orderBy(
        ...(scoreExpr
          ? [sql`${scoreExpr} DESC`, sql`char_length(${product.name}) ASC`]
          : []),
        asc(product.name),
      )
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
      score: r.score == null ? undefined : Number(r.score),
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
