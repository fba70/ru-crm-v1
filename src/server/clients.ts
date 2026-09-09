"use server"

import { db } from "@/db/drizzle"
import {
  client,
  contact,
  order,
  deal,
  type FunnelPhase,
  type EntityStatus,
  type ClientLookupCandidateJson,
  user,
} from "@/db/schema"
import {
  and,
  eq,
  ne,
  desc,
  isNull,
  or,
  count,
  inArray,
  gte,
} from "drizzle-orm"
import { computeOrderDiscount } from "@/lib/orders-format"
import { listDealFunnelStages } from "@/server/deals"
import {
  listTaskSummaryByClient,
  type ClientTaskSummary,
} from "@/server/tasks"
import { clientAtRisk } from "@/lib/client-mocks"
import { generateText, Output, stepCountIs } from "ai"
import { google } from "@ai-sdk/google"
import { z } from "zod"
import { getServerSession } from "@/lib/get-session"
import { DEFAULT_GATEWAY_ID } from "@/lib/llm-models"
import { randomUUID } from "crypto"
import { request as httpsRequest } from "node:https"
import { request as httpRequest } from "node:http"
import {
  isClientType,
  isCompanyKind,
  normalizeDiscountPercent,
  orgHasStructuredClientType,
  type ClientCustomFields,
} from "@/lib/client-custom-fields"

export type ClientContactPreview = {
  id: string
  name: string
  nameNative: string | null
  email: string | null
  phone: string | null
  position: string | null
  status: EntityStatus
}

export type ClientRow = {
  id: string
  name: string
  namePhys: string | null
  comment: string | null
  aliases: string[] | null
  phone: string | null
  email: string | null
  address: string | null
  webUrl: string | null
  customFields: ClientCustomFields
  funnelPhase: FunnelPhase
  status: EntityStatus
  currency: string
  userId: string
  userName: string | null
  organizationId: string
  createdAt: string
  updatedAt: string
  contacts: ClientContactPreview[]
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertClientInOrg(clientId: string, organizationId: string) {
  const existing = await db
    .select()
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const current = existing[0]
  if (!current) throw new Error("Client not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

export async function listClients(): Promise<ClientRow[]> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await db
    .select({
      client,
      userName: user.name,
    })
    .from(client)
    .leftJoin(user, eq(client.userId, user.id))
    .where(eq(client.organizationId, activeOrgId))
    .orderBy(desc(client.updatedAt))

  const clientIds = rows.map((r) => r.client.id)
  const contacts = clientIds.length
    ? await db
        .select()
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, activeOrgId),
            // Show every linked contact except soft-deleted ones — matches the
            // client detail page (`getClientDetail`, `ne(status,'deleted')`).
            // The old `status='active'` filter hid `initial` (New) contacts, so
            // a discovery-linked contact (created `initial`) silently vanished
            // from a New client's card even though the link exists.
            ne(contact.status, "deleted"),
          ),
        )
    : []

  const contactsByClient = new Map<string, ClientContactPreview[]>()
  for (const c of contacts) {
    if (!c.clientId) continue
    const list = contactsByClient.get(c.clientId) ?? []
    list.push({
      id: c.id,
      name: c.name,
      nameNative: c.nameNative,
      email: c.email,
      phone: c.phone,
      position: c.position,
      status: c.status,
    })
    contactsByClient.set(c.clientId, list)
  }

  return rows.map((r) => ({
    id: r.client.id,
    name: r.client.name,
    namePhys: r.client.namePhys,
    comment: r.client.comment,
    aliases: r.client.aliases,
    phone: r.client.phone,
    email: r.client.email,
    address: r.client.address,
    webUrl: r.client.webUrl,
    customFields: r.client.customFields ?? {},
    funnelPhase: r.client.funnelPhase,
    status: r.client.status,
    currency: r.client.currency,
    userId: r.client.userId,
    userName: r.userName,
    organizationId: r.client.organizationId,
    createdAt: r.client.createdAt.toISOString(),
    updatedAt: r.client.updatedAt.toISOString(),
    contacts: contactsByClient.get(r.client.id) ?? [],
  }))
}

export type ClientRevenueSummary = { revenue: number; orders: number }

// Выручка по компании за последние 12 мес. — один батч-запрос на всю
// страницу (не по одному на карточку). Те же BOOKED (finalized|confirmed) +
// NET (computeOrderDiscount) правила, что и в аналитике
// (src/server/analytics-query.ts), но без top-12-лимита и с окном "последний
// год" вместо произвольного диапазона дашборда.
export async function listClientRevenue12mo(): Promise<
  Record<string, ClientRevenueSummary>
> {
  const { activeOrgId } = await requireOrgContext()
  const since = new Date()
  since.setFullYear(since.getFullYear() - 1)

  const rows = await db
    .select({
      clientId: order.clientId,
      totalAmount: order.totalAmount,
      discountPercent: order.discountPercent,
    })
    .from(order)
    .where(
      and(
        eq(order.organizationId, activeOrgId),
        inArray(order.status, ["finalized", "confirmed"]),
        gte(order.orderDate, since),
      ),
    )

  const result: Record<string, ClientRevenueSummary> = {}
  for (const r of rows) {
    const { discountedTotal } = computeOrderDiscount(
      Number(r.totalAmount),
      Number(r.discountPercent),
    )
    const bucket = result[r.clientId] ?? { revenue: 0, orders: 0 }
    bucket.revenue += discountedTotal
    bucket.orders += 1
    result[r.clientId] = bucket
  }
  return result
}

export type ClientFeedTab =
  | "customers"
  | "potential"
  | "supplier"
  | "partner"
  | "unclassified"

// Companies page (redesign): 5 tabs, driven by a mix of deal state (Клиенты/
// Потенциальные — auto) and a manual `customFields.companyKind` tag
// (Поставщики/Партнёры, since deal state can't tell them apart — both may
// have zero deals). A manual tag always wins over deal-derived classification.
// «Не определено» catches companies with neither signal, so nothing silently
// disappears from every tab.
//
// Sort ("criticality", a heuristic proxy — TODO(backend): a real priority
// score, mirroring the same disclaimer already on `clientAtRisk` / the deals
// board's mock `agentPriorityScore`): overdue tasks first, then stale
// (no-contact) clients, then oldest-touched as the final tiebreak.
//
// This runs the tab/sort logic in JS over the org's full client set rather
// than a single paginated SQL query — acceptable at demo/pilot scale, same
// posture as `src/server/teardown.ts`'s org-wide resolution and the chat's
// `searchEverything` tool.
export async function listClientsFeed(params: {
  tab: ClientFeedTab
  status?: EntityStatus | "all"
  limit?: number
  offset?: number
}): Promise<{
  rows: ClientRow[]
  total: number
  taskSummary: Record<string, ClientTaskSummary>
}> {
  const { activeOrgId } = await requireOrgContext()
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50)
  const offset = Math.max(params.offset ?? 0, 0)

  const stages = await listDealFunnelStages()
  const closedStageIds = new Set(
    stages.filter((s) => s.closureProbability >= 1).map((s) => s.id),
  )
  const openStageIds = new Set(
    stages
      .filter((s) => s.closureProbability > 0 && s.closureProbability < 1)
      .map((s) => s.id),
  )

  const dealRows = await db
    .select({ clientId: deal.clientId, funnelStageId: deal.funnelStageId })
    .from(deal)
    .where(and(eq(deal.organizationId, activeOrgId), eq(deal.status, "active")))

  const hasClosed = new Set<string>()
  const hasOpen = new Set<string>()
  for (const d of dealRows) {
    if (closedStageIds.has(d.funnelStageId)) hasClosed.add(d.clientId)
    else if (openStageIds.has(d.funnelStageId)) hasOpen.add(d.clientId)
  }

  const statusConditions =
    params.status && params.status !== "all"
      ? [eq(client.status, params.status)]
      : [ne(client.status, "deleted"), ne(client.status, "blocked")]

  const rows = await db
    .select({ client, userName: user.name })
    .from(client)
    .leftJoin(user, eq(client.userId, user.id))
    .where(and(eq(client.organizationId, activeOrgId), ...statusConditions))

  const taskSummary = await listTaskSummaryByClient()

  const matching = rows.filter((r) => {
    const kind = r.client.customFields?.companyKind
    if (kind === "supplier") return params.tab === "supplier"
    if (kind === "partner") return params.tab === "partner"
    const closed = hasClosed.has(r.client.id)
    const open = hasOpen.has(r.client.id)
    switch (params.tab) {
      case "customers":
        return closed
      case "potential":
        return !closed && open
      case "unclassified":
        return !closed && !open
      default:
        return false
    }
  })

  matching.sort((a, b) => {
    const overdueA = taskSummary[a.client.id]?.overdueCount ?? 0
    const overdueB = taskSummary[b.client.id]?.overdueCount ?? 0
    if (overdueA !== overdueB) return overdueB - overdueA
    const staleA = clientAtRisk(a.client.updatedAt.toISOString()) ? 1 : 0
    const staleB = clientAtRisk(b.client.updatedAt.toISOString()) ? 1 : 0
    if (staleA !== staleB) return staleB - staleA
    return a.client.updatedAt.getTime() - b.client.updatedAt.getTime()
  })

  const total = matching.length
  const page = matching.slice(offset, offset + limit)

  const clientIds = page.map((r) => r.client.id)
  const contacts = clientIds.length
    ? await db
        .select()
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, activeOrgId),
            ne(contact.status, "deleted"),
            inArray(contact.clientId, clientIds),
          ),
        )
    : []
  const contactsByClient = new Map<string, ClientContactPreview[]>()
  for (const c of contacts) {
    if (!c.clientId) continue
    const list = contactsByClient.get(c.clientId) ?? []
    list.push({
      id: c.id,
      name: c.name,
      nameNative: c.nameNative,
      email: c.email,
      phone: c.phone,
      position: c.position,
      status: c.status,
    })
    contactsByClient.set(c.clientId, list)
  }

  const pageTaskSummary: Record<string, ClientTaskSummary> = {}
  for (const id of clientIds) {
    if (taskSummary[id]) pageTaskSummary[id] = taskSummary[id]
  }

  return {
    total,
    taskSummary: pageTaskSummary,
    rows: page.map((r) => ({
      id: r.client.id,
      name: r.client.name,
      namePhys: r.client.namePhys,
      comment: r.client.comment,
      aliases: r.client.aliases,
      phone: r.client.phone,
      email: r.client.email,
      address: r.client.address,
      webUrl: r.client.webUrl,
      customFields: r.client.customFields ?? {},
      funnelPhase: r.client.funnelPhase,
      status: r.client.status,
      currency: r.client.currency,
      userId: r.client.userId,
      userName: r.userName,
      organizationId: r.client.organizationId,
      createdAt: r.client.createdAt.toISOString(),
      updatedAt: r.client.updatedAt.toISOString(),
      contacts: contactsByClient.get(r.client.id) ?? [],
    })),
  }
}

/** Trim, drop empties + dups; return null for an empty list. */
function cleanAliases(raw: string[] | null | undefined): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const a of raw) {
    const t = (typeof a === "string" ? a : "").trim()
    if (!t) continue
    const lower = t.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(t)
  }
  return out.length > 0 ? out : null
}

/**
 * Normalise the custom-fields bag for the given org. The `discount` percentage
 * is kept for ALL orgs (validated to a whole 0–100, omitted when unset). The
 * structured `type` is kept only for the designated org. Unknown keys are
 * dropped — the bag is extensible by design but the server controls what lands.
 */
function normalizeClientCustomFields(
  organizationId: string,
  raw: ClientCustomFields | null | undefined,
): ClientCustomFields {
  const out: ClientCustomFields = {}
  if (orgHasStructuredClientType(organizationId) && isClientType(raw?.type)) {
    out.type = raw.type
  }
  const discount = normalizeDiscountPercent(raw?.discount)
  if (discount != null) out.discount = discount
  if (isCompanyKind(raw?.companyKind)) out.companyKind = raw.companyKind
  return out
}

// Допустимые валюты расчётов. Неизвестное значение приводим к RUB
// (форма присылает корректные коды; защита от мусора через API).
const ALLOWED_CURRENCIES = ["RUB", "USD", "EUR", "GBP", "CNY"]
function normaliseClientCurrency(currency: string | null | undefined): string {
  const c = (currency ?? "").toUpperCase()
  return ALLOWED_CURRENCIES.includes(c) ? c : "RUB"
}

export async function createClient(data: {
  name: string
  namePhys?: string | null
  comment?: string | null
  aliases?: string[] | null
  phone?: string | null
  email?: string | null
  address?: string | null
  webUrl?: string | null
  customFields?: ClientCustomFields | null
  funnelPhase?: FunnelPhase
  status?: EntityStatus
  currency?: string
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.name?.trim()) throw new Error("Name is required")

  const id = randomUUID()
  const now = new Date()
  await db.insert(client).values({
    id,
    name: data.name.trim(),
    namePhys: data.namePhys?.trim() || null,
    comment: data.comment?.trim() || null,
    aliases: cleanAliases(data.aliases),
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    address: data.address?.trim() || null,
    webUrl: data.webUrl?.trim() || null,
    customFields: normalizeClientCustomFields(activeOrgId, data.customFields),
    funnelPhase: data.funnelPhase ?? "awareness",
    status: data.status ?? "active",
    currency: normaliseClientCurrency(data.currency),
    userId: session.user.id,
    organizationId: activeOrgId,
    createdAt: now,
    updatedAt: now,
  })
  return { id }
}

export async function updateClient(
  clientId: string,
  data: {
    name?: string
    namePhys?: string | null
    comment?: string | null
    aliases?: string[] | null
    phone?: string | null
    email?: string | null
    address?: string | null
    webUrl?: string | null
    customFields?: ClientCustomFields | null
    funnelPhase?: FunnelPhase
    status?: EntityStatus
    currency?: string
  },
) {
  const { activeOrgId } = await requireOrgContext()
  await assertClientInOrg(clientId, activeOrgId)

  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name is required")
  }

  await db
    .update(client)
    .set({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.namePhys !== undefined
        ? { namePhys: data.namePhys?.trim() || null }
        : {}),
      ...(data.comment !== undefined
        ? { comment: data.comment?.trim() || null }
        : {}),
      ...(data.aliases !== undefined
        ? { aliases: cleanAliases(data.aliases) }
        : {}),
      ...(data.phone !== undefined
        ? { phone: data.phone?.trim() || null }
        : {}),
      ...(data.email !== undefined
        ? { email: data.email?.trim() || null }
        : {}),
      ...(data.address !== undefined
        ? { address: data.address?.trim() || null }
        : {}),
      ...(data.webUrl !== undefined
        ? { webUrl: data.webUrl?.trim() || null }
        : {}),
      ...(data.customFields !== undefined
        ? {
            customFields: normalizeClientCustomFields(
              activeOrgId,
              data.customFields,
            ),
          }
        : {}),
      ...(data.funnelPhase !== undefined
        ? { funnelPhase: data.funnelPhase }
        : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.currency !== undefined
        ? { currency: normaliseClientCurrency(data.currency) }
        : {}),
    })
    .where(eq(client.id, clientId))
}

// ── Web lookup (Gemini + grounded google_search) ─────────────────────

// External web search + extraction. Gemini 3.1 Flash Lite runs
// `google_search` grounding alongside function tools and is cheaper than
// 2.5 Flash; see src/lib/llm-models.ts.
const LOOKUP_RESEARCH_MODEL = DEFAULT_GATEWAY_ID
const LOOKUP_EXTRACT_MODEL = DEFAULT_GATEWAY_ID

// ── Direct homepage fetch (precision booster for the extract pass) ────
//
// Grounded google_search returns snippets, not full page bodies — so an
// address sitting in a homepage footer / Impressum frequently never reaches
// the model. When we already know the company's own URL, we additionally
// fetch the homepage + a few likely contact/legal pages and feed the raw
// text straight into the structured-extract pass as primary-source evidence.
const FETCH_TIMEOUT_MS = 8000 // per page
const MAX_EXTRA_PAGES = 4 // contact/impressum/about pages beyond the homepage
const MAX_REDIRECTS = 3
// Raw-HTML cap. Deliberately generous: a Tilda-style one-pager weighs ~1 MB of
// markup but strips down to ~5 KB of text, and the footer — where the phone and
// the address live — is the LAST thing in the file. The previous 400 KB cap cut
// it off silently, which is why site-published phones never reached the model.
const MAX_PAGE_BYTES = 3_000_000
const MAX_PAGE_TEXT = 6_000 // per-page text budget (head + footer sample)
const MAX_SITE_TEXT = 16_000 // cap the combined text handed to the LLM
// A real browser UA. Anti-DDoS front-ends (DDoS-Guard, Qrator) answer a bot UA
// with 403 on every sub-page — ntechlab.ru/about does exactly that.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
// Anchors whose href or label hint at where an address usually lives.
const ADDRESS_PAGE_HINT =
  /(contact|kontakt|contacto|contatti|impressum|imprint|about|legal|mentions[-\s]?l[eé]gales|company|firma|standort|location|контакт|адрес|реквизит|о[-\s]?нас|о[-\s]?компании|kontakty|rekvizity|o-kompanii|o-nas)/i
// Fallback guesses used only when the homepage exposes no hinted links.
const ADDRESS_PAGE_GUESSES = [
  "/contacts",
  "/contact",
  "/kontakty",
  "/kontakt",
  "/about",
  "/o-kompanii",
  "/impressum",
]

/**
 * Accept whatever a human types into the "Сайт" field. A scheme-less
 * "ntechlab.ru" made `new URL()` throw, which silently disabled the whole
 * own-site fetch and left the URL-pinned research branch chasing a bare
 * hostname. Returns "" when there is nothing usable.
 */
function normalizeSiteUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return ""
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    if (!u.hostname.includes(".")) return ""
    return u.toString().replace(/\/$/, "")
  } catch {
    return ""
  }
}

// Minimal HTML → text: drop non-content tags, turn block boundaries into
// newlines, decode the handful of entities that matter, collapse whitespace.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|footer|header|address)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t ]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Keep a page's text inside budget WITHOUT losing the footer — that is where
// the address and the phone usually sit, so a plain head-slice throws away the
// very thing we came for. Sample the head and the tail instead.
function clampPageText(text: string): string {
  if (text.length <= MAX_PAGE_TEXT) return text
  const head = text.slice(0, Math.floor(MAX_PAGE_TEXT * 0.55))
  const tail = text.slice(-Math.floor(MAX_PAGE_TEXT * 0.45))
  return `${head}\n…(middle omitted)…\n${tail}`
}

// Fetch one page → capped raw HTML, or "" on any failure (never throws).
//
// Uses node:https directly instead of global fetch for ONE reason: anti-DDoS
// front-ends (ntechlab.ru sits behind DDoS-Guard) hand a self-signed
// certificate to non-browser clients, so `fetch` dies with
// DEPTH_ZERO_SELF_SIGNED_CERT before a single byte is read. These are public
// marketing pages and we send no credentials with the request, so a relaxed
// certificate check is the difference between reading the company's own site
// and guessing from third-party news articles.
function fetchPageRaw(url: string, depth = 0): Promise<string> {
  return new Promise((resolve) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      return resolve("")
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return resolve("")
    }
    const secure = target.protocol === "https:"
    const req = (secure ? httpsRequest : httpRequest)(
      {
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        ...(secure
          ? { rejectUnauthorized: false, servername: target.hostname }
          : {}),
        headers: {
          "user-agent": BROWSER_UA,
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
          // No gzip — we would have to inflate it ourselves here.
          "accept-encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        const location = res.headers.location
        if (status >= 300 && status < 400 && location && depth < MAX_REDIRECTS) {
          res.resume()
          let next: string
          try {
            next = new URL(location, target).toString()
          } catch {
            return resolve("")
          }
          return resolve(fetchPageRaw(next, depth + 1))
        }
        if (status !== 200) {
          res.resume()
          return resolve("")
        }
        const ct = String(res.headers["content-type"] ?? "")
        if (ct && !ct.includes("html") && !ct.includes("xml")) {
          res.resume()
          return resolve("")
        }
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => {
          body += chunk
          if (body.length > MAX_PAGE_BYTES) {
            body = body.slice(0, MAX_PAGE_BYTES)
            res.destroy()
          }
        })
        res.on("close", () => resolve(body))
        res.on("error", () => resolve(body))
      },
    )
    req.on("error", () => resolve(""))
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy()
      resolve("")
    })
    req.end()
  })
}

// Same-site anchors (homepage host or a sub/parent of it) whose href/label
// hint at an address-bearing page. Deduped, capped.
function findAddressPageLinks(homeHtml: string, base: URL): string[] {
  const baseHost = base.hostname
  const sameSite = (h: string) =>
    h === baseHost || h.endsWith("." + baseHost) || baseHost.endsWith("." + h)
  const out = new Set<string>()
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(homeHtml)) && out.size < MAX_EXTRA_PAGES * 4) {
    const href = m[1]
    const label = m[2].replace(/<[^>]+>/g, " ")
    if (!ADDRESS_PAGE_HINT.test(href) && !ADDRESS_PAGE_HINT.test(label)) continue
    try {
      const abs = new URL(href, base)
      abs.hash = ""
      if (sameSite(abs.hostname) && abs.toString() !== base.toString()) {
        out.add(abs.toString())
      }
    } catch {
      /* skip unparseable href */
    }
  }
  return [...out].slice(0, MAX_EXTRA_PAGES)
}

/**
 * Fetch the company's own site (homepage + up to {@link MAX_EXTRA_PAGES}
 * hinted contact/legal pages) and return a single labelled text blob for the
 * extract pass. Best-effort: returns "" if the homepage can't be fetched.
 */
async function fetchSiteTextForLookup(knownUrl: string): Promise<string> {
  const normalized = normalizeSiteUrl(knownUrl)
  if (!normalized) return ""
  let base: URL
  try {
    base = new URL(normalized)
  } catch {
    return ""
  }

  let homeRaw = await fetchPageRaw(base.toString())
  // Some older RU corporate sites still answer on http only.
  if (!homeRaw && base.protocol === "https:") {
    const plain = new URL(base.toString())
    plain.protocol = "http:"
    homeRaw = await fetchPageRaw(plain.toString())
    if (homeRaw) base = plain
  }
  if (!homeRaw) return ""

  let links = findAddressPageLinks(homeRaw, base)
  // No hinted links on the homepage → try a few well-known paths.
  if (links.length === 0) {
    links = ADDRESS_PAGE_GUESSES.slice(0, MAX_EXTRA_PAGES).map((p) =>
      new URL(p, base).toString(),
    )
  }

  const extraRaws = await Promise.all(links.map((u) => fetchPageRaw(u)))

  const sections = [
    `# ${base.toString()}\n${clampPageText(htmlToText(homeRaw))}`,
  ]
  links.forEach((u, i) => {
    const t = clampPageText(htmlToText(extraRaws[i] || ""))
    if (t) sections.push(`# ${u}\n${t}`)
  })

  let combined = sections.join("\n\n----\n\n")
  if (combined.length > MAX_SITE_TEXT) {
    combined = combined.slice(0, MAX_SITE_TEXT) + "\n…(truncated)"
  }
  return combined
}

export type ClientLookupCandidate = {
  name: string
  email: string
  phone: string
  address: string
  webUrl: string
  confidence: "high" | "medium" | "low"
  whyMatch: string
}

export type ClientLookupSource = {
  url: string
  title: string
}

export type ClientLookupResult = {
  candidates: ClientLookupCandidate[]
  sources: ClientLookupSource[]
  /** Free-text caveat from the model — empty when there's nothing to flag. */
  notes: string
}

/**
 * Operator-typed search parameters. The stored client row is only a starting
 * point: whatever the user types in the lookup dialog overrides it for THIS
 * search (nothing is written to the DB until they press save). A `webUrl` hint
 * also switches the research on to the URL-pinned branch, which is the single
 * most effective way to stop name-similarity matches in another country.
 */
export type ClientLookupHints = {
  name?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  webUrl?: string | null
}

const lookupExtractSchema = z.object({
  candidates: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            "Canonical company name as listed on its own website / official records.",
          ),
        email: z
          .string()
          .describe(
            "Primary contact email (info@, contact@, hello@, sales@). Empty string if not found.",
          ),
        phone: z
          .string()
          .describe(
            "Primary main-office phone, in international format with the country code, exactly as the company publishes it. Do not guess the country code — take it from the source. Empty string if not found.",
          ),
        address: z
          .string()
          .describe(
            "Main / headquarters office street address as a single line, e.g. 'street, city, postcode, country'. Return whatever parts you can confirm even if incomplete (e.g. just city + country). Empty string ONLY if no address at all is found.",
          ),
        webUrl: z
          .string()
          .describe(
            "Canonical https://… homepage URL (no trailing slash). Empty string if not found.",
          ),
        confidence: z
          .enum(["high", "medium", "low"])
          .describe(
            "How confidently this candidate matches the input client. high = address or contact email matches; medium = same industry / region; low = name match only.",
          ),
        whyMatch: z
          .string()
          .describe(
            "One short sentence explaining why this is a candidate (e.g. 'Address matches your stored Vienna HQ'). Used to disambiguate between candidates.",
          ),
      }),
    )
    .max(3)
    .describe(
      "Up to 3 candidate companies that could match the input. Sort best match first. If the research clearly identifies one company, return one element.",
    ),
  notes: z
    .string()
    .describe(
      "Caveats about the search (e.g. 'Two unrelated companies share this name in different countries'). Empty string when nothing to flag.",
    ),
})

/**
 * Run a web lookup against Gemini for the given client. Two-pass:
 *
 *   1. RESEARCH — call gemini-2.5-flash with the `google_search` tool.
 *      The model writes a short freeform research note about the company
 *      using whatever it learns from the web. We capture the grounded
 *      sources (URL + title) the model used.
 *
 *   2. EXTRACT — call gemini-2.5-flash again with structured-output but
 *      no tools, feeding it the research note + the input client's
 *      current fields. Returns up to 3 candidate matches.
 *
 * Two passes (rather than one with tools+structured-output combined)
 * keeps each call inside a known-good AI SDK shape — combining tools
 * with structured output is brittle across providers / SDK versions.
 *
 * NO writes — caller invokes the existing PUT /api/clients to apply
 * whatever the user picks in the preview modal.
 *
 * `hints` are the operator's own search parameters (see {@link
 * ClientLookupHints}): they override the stored row when the prompt is built,
 * and are passed to the model as authoritative constraints. Omitted → the
 * search runs off the stored record alone, as the batch enrichment does.
 */
export async function lookupClientOnWeb(
  clientId: string,
  hints?: ClientLookupHints,
): Promise<ClientLookupResult> {
  const { activeOrgId } = await requireOrgContext()
  const target = await assertClientInOrg(clientId, activeOrgId)

  // Pull active contacts for extra disambiguation context (their names +
  // emails — never the suspended ones, those are archived).
  const contacts = await db
    .select({
      name: contact.name,
      email: contact.email,
      position: contact.position,
    })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, activeOrgId),
        eq(contact.clientId, clientId),
        eq(contact.status, "active"),
      ),
    )

  // Operator hints win over the stored row for this one search. `given` marks
  // the fields the operator typed by hand — those go into the prompt a second
  // time as hard constraints, because "the company we mean is the one in
  // Moscow" is exactly the information that stops a .com namesake winning.
  const hint = (v?: string | null) => (v ?? "").trim()
  const given = {
    name: hint(hints?.name),
    email: hint(hints?.email),
    phone: hint(hints?.phone),
    address: hint(hints?.address),
    webUrl: normalizeSiteUrl(hints?.webUrl),
  }
  const effective = {
    name: given.name || target.name,
    email: given.email || (target.email ?? "").trim(),
    phone: given.phone || (target.phone ?? "").trim(),
    address: given.address || (target.address ?? "").trim(),
    webUrl: given.webUrl || normalizeSiteUrl(target.webUrl),
  }

  const knownLines = [
    `Name: ${effective.name}`,
    effective.email ? `Email: ${effective.email}` : null,
    effective.phone ? `Phone: ${effective.phone}` : null,
    effective.address ? `Address: ${effective.address}` : null,
    effective.webUrl ? `Website: ${effective.webUrl}` : null,
    contacts.length > 0
      ? `Known contacts: ${contacts
          .map((c) => {
            const tail = [c.position, c.email].filter(Boolean).join(", ")
            return tail ? `${c.name} (${tail})` : c.name
          })
          .join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n")

  const constraintLines = [
    given.name ? `- Company name: "${given.name}" — this is the entity meant.` : null,
    given.webUrl
      ? `- Official website: ${given.webUrl} — the company behind THIS domain, no other.`
      : null,
    given.address
      ? `- Office / location: ${given.address} — reject any candidate in another city or country.`
      : null,
    given.phone ? `- Known phone: ${given.phone}` : null,
    given.email ? `- Known email: ${given.email}` : null,
  ].filter(Boolean)
  const constraints =
    constraintLines.length > 0
      ? `

Operator-confirmed parameters. These come from the CRM user, who knows this client — they are authoritative. Any candidate that contradicts them is the wrong company:
${constraintLines.join("\n")}`
      : ""

  // A known website URL is the authoritative identity of the company: when
  // it's present we pin all research to that one site and never offer
  // name-similarity alternatives (the URL, not the name, is the key criterion).
  const knownUrl = effective.webUrl
  const hasKnownUrl = knownUrl.length > 0

  // ── Pass 1: grounded research ───────────────────────────────────────
  const researchPrompt = hasKnownUrl
    ? `I have the following CRM record for a company:

${knownLines}${constraints}

This record already has a confirmed official website: ${knownUrl}

Research ONLY this exact organisation — the one that owns ${knownUrl}. Use web search to read that website (and pages directly under that same domain) to gather: official company name, primary contact email, main-office phone, headquarters address. The website URL is the authoritative identity of this company.

Do NOT consider, search for, or mention any other company that merely has a similar name — only the organisation behind ${knownUrl} matters here. Contact details published on ${knownUrl} itself outrank anything a news site, directory or aggregator says. Search in the language of that website as well as in English.

Write 1–3 short paragraphs of research notes summarising what you found on that website. State for each detail where it came from. Do NOT fabricate facts — only state what your search results actually confirm.`
    : `I have the following CRM record for a company:

${knownLines}${constraints}

Use web search to research this company. Identify the most likely real-world organisation (or organisations, if the name is ambiguous). For each candidate, gather: official company name, primary contact email, main-office phone, headquarters address, official website URL.

Search in the local language of the operator-confirmed location as well as in English — the company's own local-language site is a better source than an English directory.

Write 2–4 short paragraphs of research notes summarising what you found. If multiple companies share this name, note them separately, and say which one fits the operator-confirmed parameters. Do NOT fabricate facts — only state what your search results actually confirm.`

  // When we know the company's own URL, fetch its actual page text in
  // parallel with the grounded research — grounding only sees snippets, so
  // this is what reliably surfaces footer / Impressum addresses.
  const sitePromise = hasKnownUrl
    ? fetchSiteTextForLookup(knownUrl)
    : Promise.resolve("")

  const research = await generateText({
    model: LOOKUP_RESEARCH_MODEL,
    system:
      "You are a precise company-research assistant. Use the google_search tool to find authoritative information about the given company. Prefer official websites, LinkedIn company pages, and corporate registries over social media or aggregators. Never invent details — if a field can't be confirmed by the search results, say so explicitly.",
    prompt: researchPrompt,
    tools: { google_search: google.tools.googleSearch({}) },
    // Bound the search → fetch → answer loop so the model can't spiral.
    stopWhen: stepCountIs(5),
    // Same input must give the same answer: two runs of this lookup used to
    // return a different address and drop the phone entirely.
    temperature: 0,
  })

  const siteText = await sitePromise

  // Grounded Gemini exposes the URLs it consulted on `result.sources`.
  // The Source union has both 'url' and 'document' variants — narrow to
  // url before we read .url / .title.
  const sources: ClientLookupSource[] = (research.sources ?? []).flatMap(
    (s) =>
      s.sourceType === "url"
        ? [{ url: s.url, title: s.title ?? s.url }]
        : [],
  )

  // ── Pass 2: structured extraction ───────────────────────────────────
  const extractPrompt = hasKnownUrl
    ? `CRM record (current fields):
${knownLines}${constraints}

Research notes from web search (about ${knownUrl} only):
${research.text || "(no research output)"}
${
  siteText
    ? `
Raw text fetched directly from the company's own website (${knownUrl} and its contact / legal pages). This is PRIMARY-SOURCE evidence — prefer it over the research notes for address, phone, and email. The headquarters address is usually in the page footer or on an Impressum / legal-notice / contact page:
"""
${siteText}
"""
`
    : ""
}
The record's website URL (${knownUrl}) is the authoritative identity of this company. Return EXACTLY ONE candidate, describing the organisation behind ${knownUrl}. Set its webUrl to ${knownUrl}. Do NOT add alternative companies based on name similarity. Fill every field the research notes or website text confirm, and use empty strings for fields neither established. Set confidence to "high".

Field precedence, strongest first: (1) the raw text of the company's own website above, (2) the research notes, (3) nothing — leave the field empty. Never replace an operator-confirmed parameter with a value from a news site, directory or registry; a value from the company's own website may replace it, and if the two disagree, say so in "notes".`
    : `CRM record (current fields):
${knownLines}${constraints}

Research notes from web search:
${research.text || "(no research output)"}

Based on the research notes, extract up to 3 candidate companies that could be the right match for this CRM record. Sort by confidence (best first). For each candidate, fill every field that the research notes confirm, and use empty strings for fields the research didn't establish. Rate confidence by how well the candidate fits the operator-confirmed parameters and the record's address / contact email. Drop any candidate that contradicts an operator-confirmed parameter — do not return it as a lower-confidence alternative.`

  const { output: extracted } = await generateText({
    model: LOOKUP_EXTRACT_MODEL,
    output: Output.object({ schema: lookupExtractSchema }),
    system:
      "You convert research notes and raw company-website text into structured candidate records. Never invent fields — if neither the research notes nor the website text confirms a value, return an empty string for that field. When raw website text is provided it is primary-source evidence and outranks the research notes. Operator-confirmed parameters outrank third-party sources. Use empty arrays for the candidates list if no plausible match was found.",
    prompt: extractPrompt,
    temperature: 0,
  })

  return {
    candidates: extracted.candidates.map((c) => ({
      name: c.name.trim(),
      email: c.email.trim(),
      phone: c.phone.trim(),
      address: c.address.trim(),
      webUrl: c.webUrl.trim(),
      confidence: c.confidence,
      whyMatch: c.whyMatch.trim(),
    })),
    sources,
    notes: extracted.notes.trim(),
  }
}

// ── Batch web enrichment (refs/enrich-clients.md) ────────────────────
//
// Orchestration layer over `lookupClientOnWeb`: a browser-driven loop POSTs
// one client at a time; each client's `enrichment_status` is committed as it
// finishes, so re-running processes ONLY what's still NULL (unprocessed or
// previously failed). All org-scoped + IDOR-guarded via assertClientInOrg.

const ENRICH_FILLABLE = ["webUrl", "email", "phone", "address"] as const
type EnrichFillable = (typeof ENRICH_FILLABLE)[number]

type EnrichTarget = {
  webUrl: string | null
  email: string | null
  phone: string | null
  address: string | null
}

// True when at least one fillable field is currently blank — the gate that
// keeps us from spending LLM calls on already-complete records.
function hasBlankFillable(target: EnrichTarget): boolean {
  return ENRICH_FILLABLE.some((f) => !(target[f] ?? "").trim())
}

// Fill-blanks-only patch: never overwrites a value a human (or earlier run)
// already set. Compute once, reuse for both the DB write and the report.
function candidatePatch(
  target: EnrichTarget,
  candidate: ClientLookupCandidateJson,
): Partial<Record<EnrichFillable, string>> {
  const patch: Partial<Record<EnrichFillable, string>> = {}
  for (const field of ENRICH_FILLABLE) {
    const current = (target[field] ?? "").trim()
    const incoming = (candidate[field] ?? "").trim()
    if (!current && incoming) patch[field] = incoming
  }
  return patch
}

// 2.1 — the worklist + count for the button.
export async function listPendingEnrichIds(
  limit = 200,
): Promise<{ ids: string[]; total: number }> {
  const { activeOrgId } = await requireOrgContext()
  const cap = Math.min(limit, 500)

  const blankFillable = or(
    isNull(client.webUrl),
    eq(client.webUrl, ""),
    isNull(client.email),
    eq(client.email, ""),
    isNull(client.phone),
    eq(client.phone, ""),
    isNull(client.address),
    eq(client.address, ""),
  )
  const where = and(
    eq(client.organizationId, activeOrgId),
    isNull(client.enrichmentStatus),
    inArray(client.status, ["active", "initial"]),
    blankFillable,
  )

  const idRows = await db
    .select({ id: client.id })
    .from(client)
    .where(where)
    .orderBy(desc(client.updatedAt))
    .limit(cap)
  const totalRows = await db
    .select({ c: count() })
    .from(client)
    .where(where)

  return { ids: idRows.map((r) => r.id), total: totalRows[0]?.c ?? 0 }
}

export type EnrichClientResult = {
  outcome: "enriched" | "review" | "no_match" | "skipped"
  filledFields: EnrichFillable[]
  candidateCount: number
}

// 2.2 — process ONE client. Never catches the lookup error: on a throw the
// row stays NULL so the next run retries only it (the whole resumability
// guarantee depends on this).
export async function enrichClientFromWeb(
  clientId: string,
): Promise<EnrichClientResult> {
  const { activeOrgId } = await requireOrgContext()
  const target = await assertClientInOrg(clientId, activeOrgId)

  // Raced to complete between the worklist snapshot and now → stamp + skip.
  if (!hasBlankFillable(target)) {
    await db
      .update(client)
      .set({ enrichmentStatus: "enriched", enrichmentCandidates: null })
      .where(eq(client.id, clientId))
    return { outcome: "skipped", filledFields: [], candidateCount: 0 }
  }

  const { candidates } = await lookupClientOnWeb(clientId)

  if (candidates.length === 0) {
    await db
      .update(client)
      .set({ enrichmentStatus: "no_match", enrichmentCandidates: null })
      .where(eq(client.id, clientId))
    return { outcome: "no_match", filledFields: [], candidateCount: 0 }
  }

  // Auto-apply ONLY the unambiguous case: a single high-confidence candidate.
  // Anything else (>1 candidate, or a lone medium/low) goes to the human queue.
  if (candidates.length === 1 && candidates[0].confidence === "high") {
    const patch = candidatePatch(target, candidates[0])
    await db
      .update(client)
      .set({ ...patch, enrichmentStatus: "enriched", enrichmentCandidates: null })
      .where(eq(client.id, clientId))
    return {
      outcome: "enriched",
      filledFields: Object.keys(patch) as EnrichFillable[],
      candidateCount: 1,
    }
  }

  await db
    .update(client)
    .set({ enrichmentStatus: "review", enrichmentCandidates: candidates })
    .where(eq(client.id, clientId))
  return { outcome: "review", filledFields: [], candidateCount: candidates.length }
}

export type EnrichReviewRow = {
  id: string
  name: string
  webUrl: string | null
  email: string | null
  phone: string | null
  address: string | null
  candidates: ClientLookupCandidateJson[]
}

// 2.3 — the manual disambiguation queue (status='review') + its count.
export async function listEnrichReview(): Promise<EnrichReviewRow[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({
      id: client.id,
      name: client.name,
      webUrl: client.webUrl,
      email: client.email,
      phone: client.phone,
      address: client.address,
      candidates: client.enrichmentCandidates,
    })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        eq(client.enrichmentStatus, "review"),
      ),
    )
    .orderBy(desc(client.updatedAt))
  return rows.map((r) => ({ ...r, candidates: r.candidates ?? [] }))
}

export async function countEnrichReview(): Promise<number> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({ c: count() })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        eq(client.enrichmentStatus, "review"),
      ),
    )
  return rows[0]?.c ?? 0
}

export type ResolveEnrichmentChoice =
  | { candidateIndex: number }
  | { skip: true }

// 2.4 — apply a human's pick (or dismiss) for a parked client. No new web
// call — replays the candidates stored during the batch.
export async function resolveEnrichment(
  clientId: string,
  choice: ResolveEnrichmentChoice,
): Promise<{ outcome: "enriched" | "no_match"; filledFields: EnrichFillable[] }> {
  const { activeOrgId } = await requireOrgContext()
  const target = await assertClientInOrg(clientId, activeOrgId)

  if ("skip" in choice && choice.skip) {
    await db
      .update(client)
      .set({ enrichmentStatus: "no_match", enrichmentCandidates: null })
      .where(eq(client.id, clientId))
    return { outcome: "no_match", filledFields: [] }
  }

  const candidateIndex = "candidateIndex" in choice ? choice.candidateIndex : -1
  const candidates = (target.enrichmentCandidates ??
    []) as ClientLookupCandidateJson[]
  const chosen = candidates[candidateIndex]
  if (!chosen) throw new Error("Candidate not found")

  const patch = candidatePatch(target, chosen)
  await db
    .update(client)
    .set({ ...patch, enrichmentStatus: "enriched", enrichmentCandidates: null })
    .where(eq(client.id, clientId))
  return { outcome: "enriched", filledFields: Object.keys(patch) as EnrichFillable[] }
}
