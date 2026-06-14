"use server"

import { db } from "@/db/drizzle"
import { product, type EntityStatus } from "@/db/schema"
import { and, asc, count, eq, sql } from "drizzle-orm"
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

// `additional_metadata` keys probed by the ranked TERM search. Deliberately
// identity/attribute fields only, NOT prose (`description`/`taste`/…) — so a
// token like "Dry" doesn't score every wine whose tasting notes say "dry", and
// a brand like "Martini" isn't out-ranked by the ~130 wines whose description
// merely suggests serving it in a martini. Term matching targets the product's
// NAME and its defining attributes across both languages.
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

// Generic drink-KIND words (the ones the order-request prompt always asks the
// model to translate: Вино/Wine, Игристое/Sparkling, Джин/Gin, …). They match
// huge swathes of the catalog and carry almost no discriminating signal, yet
// the LLM includes them inconsistently — and a length-based weight rated
// "Wine"/"Вино" (len 4) at 1.3, enough to reshuffle the ranking when present.
// Pinning them to a tiny weight makes their presence/absence barely move
// results, so the brand/grape words decide the ranking. Both languages, plus
// the few spellings the model emits. Compared lowercased.
const KIND_WORDS = new Set([
  "вино", "wine", "игристое", "sparkling", "шампанское", "champagne",
  "джин", "gin", "водка", "vodka", "виски", "whisky", "whiskey",
  "текила", "tequila", "ром", "rum", "коньяк", "cognac",
  "ликёр", "ликер", "liqueur",
])
const KIND_WORD_WEIGHT = 0.25

// Per-term distinctiveness weight: rare/long/numeric tokens (brand words,
// proof/age numbers like "135") discriminate far better than short common
// kind-words ("Gin", "Dry", "Вино"), so they should dominate the score.
function termWeight(t: string): number {
  if (KIND_WORDS.has(t.toLowerCase())) return KIND_WORD_WEIGHT
  if (/^\d+$/.test(t)) return 2.5
  if (t.length >= 6) return 1.8
  if (t.length >= 4) return 1.3
  return 0.8
}

// Fuzzy (trigram) brand matching kicks in only for distinctive brand-length
// tokens — short/common words would match noise. A token this long that ISN'T
// an exact substring of a product name still counts as a name hit when its
// pg_trgm word_similarity clears FUZZY_SIM. This rescues brand transliteration
// drift (e.g. the model writing "Descombes" for catalog "Descombe"), which
// otherwise drops the actually-requested product out of the ranking entirely.
const FUZZY_MIN_LEN = 6
// Trigram threshold for a fuzzy name match. 0.7 admits genuine transliteration
// drift ("Descombes"≈"Descombe" = 0.8) while rejecting coincidental trigram
// overlap ("Martiena"≈"martini" = 0.625) that has nothing to do with the query.
const FUZZY_SIM = 0.7
// A fuzzy name hit scores BELOW an exact substring hit (FIELD_W.name = 3), so
// every product that literally contains the query term outranks a merely
// similar name — yet it still beats no match, so a misspelled brand with NO
// exact match anywhere is still surfaced. (Above category/attribute weights so
// a near-brand still beats a generic attribute hit.)
const FUZZY_NAME_W = 2.5

// Ranked-search relevance cutoff. Terms rank rather than filter (so a pure
// transliteration miss never blanks the catalog — see the WHERE note below),
// but without ANY cutoff the result `total` is the whole catalog: every row
// the structured filters leave in, ranked, even the ones that match no term.
// To "drop very low probability" matches we keep only rows scoring at least
// this fraction of the BEST score in the candidate set. A strong multi-term
// hit (brand in the name + grape) raises the bar so the long tail of rows
// that matched only one short common word ("Noir" / "Wine") falls away, while
// genuinely strong matches survive. Applied ONLY when something actually
// matched (max score > 0); when nothing matches we fall back to the full
// ranked catalog so the wizard step never shows an empty table. Tunable:
// higher = tighter/shorter list, lower = more permissive.
const MIN_SCORE_RATIO = 0.4

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
  // Manual search box (`q`) and the wizard's `terms` share ONE ranked path: a
  // free-text `q` is tokenised into terms so NAME hits rank above description /
  // vendor hits, and a multi-word query ("martini dry") matches by token
  // coverage instead of as a single contiguous substring. (The old `q` was an
  // un-ranked OR-filter over name + prose fields sorted alphabetically, which
  // buried real "Martini …" products under ~130 wines whose *description* just
  // mentions martini, and made "martini dry" match almost nothing.) Explicit
  // `terms` from the order-request wizard take precedence when provided.
  const effectiveTerms =
    params.terms && params.terms.length > 0
      ? params.terms
      : q
        ? q.split(/\s+/)
        : []
  const uniqueTerms = [
    ...new Map(
      effectiveTerms
        .map((t) => t.trim())
        .filter((t) => t.length >= MIN_TERM_LEN)
        .map((t) => [t.toLowerCase(), t] as const),
    ).values(),
  ].slice(0, 16)
  const hasTerms = uniqueTerms.length > 0

  const termScore = (t: string) => {
    const like = `%${t}%`
    const w = termWeight(t)
    // Distinctive brand-length tokens get a fuzzy fallback on the NAME: an
    // exact substring scores FIELD_W.name, but a close trigram match (e.g.
    // "Descombes" ≈ "Descombe") also counts as a full name hit so a one-letter
    // transliteration drift no longer hides the requested product.
    const fuzzy = t.length >= FUZZY_MIN_LEN && !KIND_WORDS.has(t.toLowerCase())
    const nameHit = fuzzy
      ? sql`CASE
            WHEN ${product.name} ILIKE ${like} THEN ${FIELD_W.name}
            WHEN word_similarity(${t}, ${product.name}) >= ${FUZZY_SIM} THEN (${FUZZY_NAME_W})::float8
            ELSE 0 END`
      : sql`CASE WHEN ${product.name} ILIKE ${like} THEN ${FIELD_W.name} ELSE 0 END`
    // `w` is a JS float (0.8 / 1.3 / 1.8 / 2.5) sent as an untyped param. In
    // `$param * GREATEST(<int CASEs>)` Postgres resolves `unknown * int4` and
    // tries to cast the literal to INTEGER → "invalid input syntax for type
    // integer: 0.8" (every terms query 500s → empty catalog). Cast to float8
    // so the multiplication stays numeric. (Regression from the ranked-search
    // rewrite in dc63edf — see PHASE2 / git blame.)
    return sql`(${w})::float8 * GREATEST(
      ${nameHit},
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

  const baseWhere = and(
    eq(product.organizationId, activeOrgId),
    eq(product.status, "active"),
    // NOTE: terms intentionally do NOT appear here — they rank (orderBy), not
    // filter, so an unmatched term never empties the catalog. The relevance
    // CUTOFF below (relative to the best score) is what trims the long tail;
    // it's gated on max-score > 0 for the same never-blank reason. See
    // termScore + MIN_SCORE_RATIO.
    category && category.length > 0
      ? eq(product.category, category)
      : undefined,
    // `q` is NOT a hard filter — it's tokenised into `effectiveTerms` above and
    // drives the weighted ranking + relevance cutoff, so name/brand hits rank
    // first and prose-only matches (a description that merely mentions the term)
    // fall below the cutoff instead of flooding the list. Barcode/code lookups
    // still work via the `accounting_metadata` field weight in the score.
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

  // Relevance cutoff (only meaningful when terms were supplied). One cheap
  // aggregate pass over the structured-filtered set finds the best score; we
  // then keep rows within MIN_SCORE_RATIO of it. Gated on max > 0 so a
  // transliteration miss (every row scores 0) falls back to the full ranked
  // catalog instead of an empty table.
  let where = baseWhere
  if (hasTerms && scoreExpr) {
    const maxRow = await db
      .select({ m: sql<number | null>`MAX(${scoreExpr})` })
      .from(product)
      .where(baseWhere)
    const maxScore = Number(maxRow[0]?.m ?? 0)
    if (maxScore > 0) {
      const threshold = maxScore * MIN_SCORE_RATIO
      where = and(baseWhere, sql`${scoreExpr} >= ${threshold}`)
    }
  }

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
        // Final unique tiebreaker. The catalog has many same-named SKUs that
        // tie on score AND name; without a stable last key Postgres returns
        // them in arbitrary, run-varying physical order, so the top row (the
        // "Best match" badge) and the page-boundary cut shuffled between
        // identical queries. Ordering by id makes every query reproducible.
        asc(product.id),
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
