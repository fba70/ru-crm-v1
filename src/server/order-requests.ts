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
  // Russian phrase (empty when filters fully express the intent).
  searchPhrase: z.string(),
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

// Clean the LLM's sentinel-filled filter object into a sparse one.
function cleanFilters(f: z.infer<typeof llmFilterSchema>): OrderRequestItemFilters {
  const out: OrderRequestItemFilters = {}
  const s = (v: string) => {
    const t = v.trim()
    return t.length ? t : undefined
  }
  if (s(f.category)) out.category = s(f.category)
  if (s(f.type)) out.type = s(f.type)
  if (s(f.color)) out.color = s(f.color)
  if (s(f.sugar)) out.sugar = s(f.sugar)
  if (s(f.aging)) out.aging = s(f.aging)
  if (s(f.bottleVolume)) out.bottleVolume = s(f.bottleVolume)
  if (s(f.countryName)) out.countryName = s(f.countryName)
  if (Number.isFinite(f.priceMin) && f.priceMin > 0) out.priceMin = f.priceMin
  if (Number.isFinite(f.priceMax) && f.priceMax > 0) out.priceMax = f.priceMax
  return out
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

    const items = output.items.slice(0, MAX_ITEMS)
    if (items.length > 0) {
      await db.insert(orderRequestItem).values(
        items.map((it, i) => {
          const phrase = it.searchPhrase.trim()
          const qty = it.quantityHint.trim()
          const label = it.label.trim()
          return {
            id: randomUUID(),
            requestId,
            ordinal: i,
            rawSnippet: it.rawSnippet.trim() || label || phrase || "—",
            label: label || phrase || null,
            mode: it.mode,
            filters: cleanFilters(it.filters),
            searchPhrase: phrase || null,
            quantityHint: qty || null,
            status: "pending" as const,
          }
        }),
      )
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
