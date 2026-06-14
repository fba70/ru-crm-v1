import "server-only"

import { db } from "@/db/drizzle"
import {
  client,
  order,
  orderRequest,
  orderRequestItem,
  type OrderRequestStatus,
  type OrderRequestItemMode,
  type OrderRequestItemStatus,
} from "@/db/schema"
import { and, asc, eq } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import {
  listProductCategories,
  listProductFilterOptions,
  listProducts,
} from "@/server/products"
import { getGatewayId, DEFAULT_MODEL_KEY } from "@/lib/llm-models"
import type { OrderRequestItemFilters } from "@/lib/order-request"
import { generateText, Output } from "ai"
import { z } from "zod"
import { randomUUID } from "crypto"

// Truncation guard for very long pasted messages (mirrors discovery flows).
const MAX_REQUEST_CHARS = 40_000
// Defensive cap on how many intent items one paste can yield.
const MAX_ITEMS = 60
// Filter dropdowns with more distinct values than this are too free-text-y to
// hand the LLM as a closed vocabulary (e.g. thousands of appellations) — for
// those the model falls back to a `searchPhrase` instead.
const MAX_ENUM_VALUES = 80

// ── Views returned to the API/UI ─────────────────────────────────────
export type OrderRequestItemView = {
  id: string
  ordinal: number
  rawSnippet: string
  label: string | null
  mode: OrderRequestItemMode
  filters: OrderRequestItemFilters
  searchPhrase: string | null
  searchTerms: string[]
  quantityHint: string | null
  status: OrderRequestItemStatus
}

export type OrderRequestDetail = {
  id: string
  rawText: string
  comment: string | null
  status: OrderRequestStatus
  parseError: string | null
  clientId: string
  orderId: string | null
  items: OrderRequestItemView[]
}

export type CreateOrderRequestInput = {
  clientId: string
  rawText: string
  comment?: string | null
  modelKey?: string
}

// ── LLM output schema ────────────────────────────────────────────────
//
// Flat, all-required fields with "" / 0 sentinels — Gemini's structured
// output can't express nullable/oneOf, so the server cleans empties after.
// `filters` only exposes the bounded, closed-vocabulary catalog attributes;
// the rest (year/rating/appellation) stay rep-driven in the wizard.
const llmFilterSchema = z.object({
  category: z.string(),
  type: z.string(),
  color: z.string(),
  sugar: z.string(),
  aging: z.string(),
  bottleVolume: z.string(),
  countryName: z.string(),
  priceMin: z.number(),
  priceMax: z.number(),
})

const llmItemSchema = z.object({
  // The exact fragment of the message this intent came from.
  rawSnippet: z.string(),
  // Short human label for the wizard step header.
  label: z.string(),
  mode: z.enum(["explicit", "discovery"]),
  // explicit → Latin transliteration of the named brand; discovery → optional
  // Russian phrase (empty when filters fully express the intent). Display only.
  searchPhrase: z.string(),
  // Bilingual search tokens (both the original RU words AND their EN
  // translation/transliteration) for ranked, order-independent matching.
  searchTerms: z.array(z.string()),
  // Raw quantity text as written ("6", "15 л", "0,7"), empty when not stated.
  quantityHint: z.string(),
  filters: llmFilterSchema,
})

const llmParseSchema = z.object({
  items: z.array(llmItemSchema),
})

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertClientInOrg(clientId: string, organizationId: string) {
  const rows = await db
    .select({ id: client.id, organizationId: client.organizationId, status: client.status })
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const current = rows[0]
  if (!current) throw new Error("Client not found")
  if (current.organizationId !== organizationId) throw new Error("Unauthorized")
  if (current.status === "deleted") throw new Error("Client is deleted")
  return current
}

async function loadRequestRow(id: string, organizationId: string) {
  const rows = await db
    .select()
    .from(orderRequest)
    .where(eq(orderRequest.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error("Order request not found")
  if (row.organizationId !== organizationId) throw new Error("Unauthorized")
  return row
}

// Only keep enum lists short enough to act as a closed vocabulary for the LLM.
function asClosedVocab(values: string[]): string[] {
  return values.length > 0 && values.length <= MAX_ENUM_VALUES ? values : []
}

function buildParsePrompt(opts: {
  rawText: string
  categories: string[]
  filterOptions: {
    type: string[]
    color: string[]
    sugar: string[]
    aging: string[]
    bottleVolume: string[]
    countryName: string[]
  }
}): string {
  const list = (label: string, values: string[]) =>
    values.length
      ? `- ${label}: ${values.join(", ")}`
      : `- ${label}: (not provided — use a searchPhrase instead)`

  return [
    "Below is a free-text product request from a client of a wine & spirits",
    "distributor, written in informal Russian. Split it into individual",
    "product intent items. Each item becomes one step in an order-assembly",
    "wizard and may map to one or many catalog products.",
    "",
    "For EACH intent decide a `mode`:",
    '- "explicit": the client named a specific product/brand (often in',
    "  Cyrillic transliteration, e.g. «Вильям лоусон», «Хосе куэрво»,",
    "  «Мартини Россо», «Нонино»). Put a LATIN transliteration of the brand in",
    "  `searchPhrase` (e.g. «Вильям лоусон» → \"William Lawson\", «Хосе куэрво»",
    '  → "Jose Cuervo", «Нонино» → "Nonino"). Leave `filters` empty. Put the',
    "  stated quantity in `quantityHint` verbatim (e.g. \"6\", \"15 л\", \"0,7\").",
    '- "discovery": a vague or category-level ask (e.g. «все по Бурбону и',
    "  Айла», «российские игристые», «красное полусухое до 1000»). Fill",
    "  `filters` using ONLY the exact allowed values listed below; set",
    "  `priceMax`/`priceMin` from any stated price ceiling/floor in RUB. You",
    "  may also add a Russian `searchPhrase` for nuance not covered by",
    "  filters. `quantityHint` only if a quantity was stated.",
    "",
    "For EVERY item also produce `searchTerms`: 3–10 short tokens used to FIND",
    "the product in a catalog whose names MIX Russian and English. The search",
    "matches ANY token and ranks products by how many tokens hit, so include",
    "tokens in BOTH languages and do NOT worry about word order or exact",
    "spelling. Build them from each meaningful word of the product (NOT",
    "greetings, quantities, or units like «бут»/«л»/«шт»): keep the original",
    "word AND add its English translation/transliteration. ALWAYS translate the",
    "drink-kind word: Джин→Gin, Водка→Vodka, Вино→Wine, Виски→Whisky,",
    "Текила→Tequila, Ром→Rum, Коньяк→Cognac, Ликёр→Liqueur,",
    "Шампанское→Champagne, Игристое→Sparkling. Keep numbers that are part of",
    "the name (135, 12). Example: «Джин хиога драй 135» →",
    '["Джин","Gin","хиога","Hyoga","драй","Dry","135"]. Deduplicate.',
    "",
    "Allowed catalog values — filter values MUST be copied EXACTLY from these",
    "lists (they are Russian, UPPERCASE for attributes). If nothing fits an",
    "intent, leave that filter empty and rely on `searchPhrase`:",
    list("category", opts.categories),
    list("type", opts.filterOptions.type),
    list("color", opts.filterOptions.color),
    list("sugar", opts.filterOptions.sugar),
    list("aging", opts.filterOptions.aging),
    list("bottleVolume", opts.filterOptions.bottleVolume),
    list("countryName", opts.filterOptions.countryName),
    "",
    "Rules:",
    "- `label`: a short, descriptive name for the intent in the request's own",
    "  language (e.g. «Рислинг, Германия», «Bombay Sapphire», «Игристое до 2000»)",
    "  — NOT a bare category like «вино».",
    "- Ignore non-product content: greetings, names of people, venue logistics,",
    "  delivery windows, payment terms, jokes. Emit ONLY product intents.",
    "- One line / one named product = one item. Keep the client's order.",
    "- If the message contains several sub-orders (e.g. «Заявка 1 … Заявка 2"
      + " …»), flatten every product line into the single items list.",
    "- Unset string fields = \"\"; unset price = 0. Never invent filter values.",
    `- Emit at most ${MAX_ITEMS} items.`,
    "",
    "REQUEST:",
    opts.rawText,
  ].join("\n")
}

// Multilingual connector particles that appear in many product names (RU + EN
// + romance) and only add noise to a token-OR ranked search — the distinctive
// words carry the match. Dropped from search terms (lowercased compare).
const TERM_STOPWORDS = new Set([
  "the", "and", "of", "de", "la", "le", "el", "los", "las", "del",
  "della", "di", "du", "des", "da", "do", "dos", "von", "van",
  "де", "ля", "ле", "ла", "лос", "лас", "дель", "ди", "да", "по", "на",
])

// Dedupe (case-insensitive) + trim search tokens, drop too-short ones +
// connector stopwords, cap the count.
function cleanTerms(terms: string[]): string[] {
  return [
    ...new Map(
      terms
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !TERM_STOPWORDS.has(t.toLowerCase()))
        .map((t) => [t.toLowerCase(), t] as const),
    ).values(),
  ].slice(0, 16)
}

type FilterVocab = {
  category: string[]
  type: string[]
  color: string[]
  sugar: string[]
  aging: string[]
  bottleVolume: string[]
  countryName: string[]
}

// Case-insensitively snap a value to the catalog's exact vocabulary, or drop
// it. The prompt asks the LLM to copy allowed values verbatim, but it drifts:
// it returns Title-case "Вино" for the catalog's "ВИНО", or INVENTS "Вино" as
// a `category` when the real categories are "Белое"/"Красное"/… These land as
// exact-match `eq` filters in the wizard catalog query → zero rows. (This is
// exactly why a clear "вионье" request found nothing: filters were
// {category:"Вино", type:"Вино", …} and neither value exists as-is.) Keeping
// only real values — normalised to the catalog's spelling — means a bad guess
// degrades to pure term ranking instead of an empty result.
function snapToVocab(value: string, allowed: string[]): string | undefined {
  const v = value.trim()
  if (!v) return undefined
  return allowed.find((a) => a.toLowerCase() === v.toLowerCase())
}

// Clean the LLM's sentinel-filled filter object into a sparse one, validated
// against the real catalog vocabulary (hallucinated / mis-cased values dropped).
function cleanFilters(
  f: z.infer<typeof llmFilterSchema>,
  vocab: FilterVocab,
): OrderRequestItemFilters {
  const out: OrderRequestItemFilters = {}
  const category = snapToVocab(f.category, vocab.category)
  if (category) out.category = category
  const type = snapToVocab(f.type, vocab.type)
  if (type) out.type = type
  const color = snapToVocab(f.color, vocab.color)
  if (color) out.color = color
  const sugar = snapToVocab(f.sugar, vocab.sugar)
  if (sugar) out.sugar = sugar
  const aging = snapToVocab(f.aging, vocab.aging)
  if (aging) out.aging = aging
  const bottleVolume = snapToVocab(f.bottleVolume, vocab.bottleVolume)
  if (bottleVolume) out.bottleVolume = bottleVolume
  const countryName = snapToVocab(f.countryName, vocab.countryName)
  if (countryName) out.countryName = countryName
  if (Number.isFinite(f.priceMin) && f.priceMin > 0) out.priceMin = f.priceMin
  if (Number.isFinite(f.priceMax) && f.priceMax > 0) out.priceMax = f.priceMax
  return out
}

// A discovery item's structured filters are applied as a hard AND of exact
// matches in the catalog query, so a single bad value — the LLM picking a
// real-but-WRONG `category` (e.g. "Вино" when the Viognier whites live under
// "Белое") — eliminates EVERY row even for an obviously-satisfiable request.
// Term ranking is robust; the filters are brittle. So if the filters zero out
// a request that terms alone CAN match, relax them: drop the redundant kind
// facets (category/type) first, then every attribute facet, keeping price. The
// step then falls back to ranked term search instead of an empty catalog.
async function relaxOverConstrainedFilters(
  terms: string[],
  filters: OrderRequestItemFilters,
): Promise<OrderRequestItemFilters> {
  const ATTR_KEYS = [
    "category", "type", "color", "sugar", "aging", "bottleVolume", "countryName",
  ] as const
  const hasAttr = ATTR_KEYS.some((k) => filters[k])
  if (!hasAttr || terms.length === 0) return filters

  const total = async (f: OrderRequestItemFilters) =>
    (await listProducts({ terms, ...f, limit: 1 })).total

  if ((await total(filters)) > 0) return filters // filters already match

  // Relaxing only helps if terms alone (price kept) are matchable at all.
  const priceOnly: OrderRequestItemFilters = {}
  if (filters.priceMin != null) priceOnly.priceMin = filters.priceMin
  if (filters.priceMax != null) priceOnly.priceMax = filters.priceMax
  if ((await total(priceOnly)) === 0) return filters

  // Step 1: drop the redundant kind facets, keep the descriptive ones.
  const rest: OrderRequestItemFilters = { ...filters }
  delete rest.category
  delete rest.type
  if (ATTR_KEYS.some((k) => rest[k]) && (await total(rest)) > 0) return rest

  // Step 2: drop every attribute facet, keep price only.
  return priceOnly
}

// Create the request row, run ONE LLM split, persist the resulting intent
// items, and flip the request to `ready`. A parse failure is non-fatal: the
// row lands `ready` with `parseError` set and zero items, so the rep can
// still assemble the order manually from the same wizard entry point.
export async function createAndParseOrderRequest(
  input: CreateOrderRequestInput,
): Promise<{ id: string }> {
  const { session, activeOrgId } = await requireOrgContext()
  await assertClientInOrg(input.clientId, activeOrgId)

  const rawText = input.rawText.trim()
  if (!rawText) throw new Error("Request text is empty")
  const truncated =
    rawText.length > MAX_REQUEST_CHARS
      ? rawText.slice(0, MAX_REQUEST_CHARS) + "\n\n[…truncated]"
      : rawText

  const requestId = randomUUID()
  await db.insert(orderRequest).values({
    id: requestId,
    rawText,
    comment: input.comment?.trim() || null,
    status: "parsing",
    clientId: input.clientId,
    userId: session.user.id,
    organizationId: activeOrgId,
  })

  try {
    const [categories, filterOptions] = await Promise.all([
      listProductCategories(),
      listProductFilterOptions(),
    ])

    const gatewayId = getGatewayId(input.modelKey ?? DEFAULT_MODEL_KEY)
    const { output } = await generateText({
      model: gatewayId,
      // Deterministic split: the same client message must yield the same
      // search terms every run. At the provider default temperature the model
      // drifts the term bag (adds/drops generic kind-words like "wine", varies
      // a brand's transliteration "Descombe"/"Descombes"), and because those
      // tokens reshape the ranked catalog, the wizard showed "very different
      // results" for an identical request. temperature 0 removes that drift.
      temperature: 0,
      output: Output.object({ schema: llmParseSchema }),
      system:
        "You are a precise order-intake assistant for a wine & spirits " +
        "distributor. You split one informal Russian client message into " +
        "structured product intent items. You never invent catalog filter " +
        "values — you only copy from the provided lists — and for named " +
        "brands you transliterate Cyrillic to a Latin search phrase.",
      prompt: buildParsePrompt({
        rawText: truncated,
        categories: asClosedVocab(categories),
        filterOptions: {
          type: asClosedVocab(filterOptions.type),
          color: asClosedVocab(filterOptions.color),
          sugar: asClosedVocab(filterOptions.sugar),
          aging: asClosedVocab(filterOptions.aging),
          bottleVolume: asClosedVocab(filterOptions.bottleVolume),
          countryName: asClosedVocab(filterOptions.countryName),
        },
      }),
    })

    // Validate LLM filters against the FULL catalog vocabulary (not the
    // 80-value prompt cap) — so a real value the model copied still survives
    // even when its attribute list was too long to hand it as a closed vocab.
    const filterVocab: FilterVocab = {
      category: categories,
      type: filterOptions.type,
      color: filterOptions.color,
      sugar: filterOptions.sugar,
      aging: filterOptions.aging,
      bottleVolume: filterOptions.bottleVolume,
      countryName: filterOptions.countryName,
    }

    const items = output.items.slice(0, MAX_ITEMS)
    if (items.length > 0) {
      const values = []
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        const phrase = it.searchPhrase.trim()
        const qty = it.quantityHint.trim()
        const label = it.label.trim()
        const terms = cleanTerms(it.searchTerms ?? [])
        const filters = await relaxOverConstrainedFilters(
          terms,
          cleanFilters(it.filters, filterVocab),
        )
        values.push({
          id: randomUUID(),
          requestId,
          ordinal: i,
          rawSnippet: it.rawSnippet.trim() || label || phrase || "—",
          label: label || phrase || null,
          mode: it.mode,
          filters,
          searchPhrase: phrase || null,
          searchTerms: terms.length ? terms : null,
          quantityHint: qty || null,
          status: "pending" as const,
        })
      }
      await db.insert(orderRequestItem).values(values)
    }

    await db
      .update(orderRequest)
      .set({ status: "ready", parseError: null })
      .where(eq(orderRequest.id, requestId))
  } catch (err) {
    const message = err instanceof Error ? err.message : "parse failed"
    await db
      .update(orderRequest)
      .set({ status: "ready", parseError: message })
      .where(eq(orderRequest.id, requestId))
  }

  return { id: requestId }
}

export async function getOrderRequest(
  id: string,
): Promise<OrderRequestDetail | null> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await db
    .select()
    .from(orderRequest)
    .where(
      and(
        eq(orderRequest.id, id),
        eq(orderRequest.organizationId, activeOrgId),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null

  const items = await db
    .select()
    .from(orderRequestItem)
    .where(eq(orderRequestItem.requestId, id))
    .orderBy(asc(orderRequestItem.ordinal))

  return {
    id: row.id,
    rawText: row.rawText,
    comment: row.comment,
    status: row.status,
    parseError: row.parseError,
    clientId: row.clientId,
    orderId: row.orderId,
    items: items.map((it) => ({
      id: it.id,
      ordinal: it.ordinal,
      rawSnippet: it.rawSnippet,
      label: it.label,
      mode: it.mode,
      filters: (it.filters ?? {}) as OrderRequestItemFilters,
      searchPhrase: it.searchPhrase,
      searchTerms: it.searchTerms ?? [],
      quantityHint: it.quantityHint,
      status: it.status,
    })),
  }
}

// Link the freshly-minted draft order to the request and mark it as being
// assembled. Idempotent — safe to call on every wizard persist.
export async function linkOrderToRequest(
  requestId: string,
  orderId: string,
): Promise<void> {
  const { activeOrgId } = await requireOrgContext()
  await loadRequestRow(requestId, activeOrgId)

  // The order must belong to the same org.
  const orderRows = await db
    .select({ id: order.id, organizationId: order.organizationId })
    .from(order)
    .where(eq(order.id, orderId))
    .limit(1)
  const ord = orderRows[0]
  if (!ord) throw new Error("Order not found")
  if (ord.organizationId !== activeOrgId) throw new Error("Unauthorized")

  await db
    .update(orderRequest)
    .set({ orderId, status: "assembling" })
    .where(eq(orderRequest.id, requestId))
}

export async function updateOrderRequestItemStatus(
  requestId: string,
  itemId: string,
  status: OrderRequestItemStatus,
): Promise<void> {
  const { activeOrgId } = await requireOrgContext()
  await loadRequestRow(requestId, activeOrgId)
  await db
    .update(orderRequestItem)
    .set({ status })
    .where(
      and(
        eq(orderRequestItem.id, itemId),
        eq(orderRequestItem.requestId, requestId),
      ),
    )
}

export async function setOrderRequestStatus(
  requestId: string,
  status: Extract<OrderRequestStatus, "done" | "abandoned" | "assembling">,
): Promise<void> {
  const { activeOrgId } = await requireOrgContext()
  await loadRequestRow(requestId, activeOrgId)
  await db
    .update(orderRequest)
    .set({ status })
    .where(eq(orderRequest.id, requestId))
}
