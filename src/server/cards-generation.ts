import "server-only"

import { db } from "@/db/drizzle"
import {
  card,
  cardClient,
  cardContact,
  cardUser,
  client,
  contact,
  member,
  rule,
  source,
  sourceItem,
  user,
  type CardCategory,
  type CardPriority,
} from "@/db/schema"
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { getMarkdownFromR2 } from "@/lib/r2"
import { getGatewayId } from "@/lib/llm-models"
import { loadOwnOrgIdentity, type OwnOrgIdentity } from "@/server/org-identity"
import { extractEmailDomain } from "@/lib/email-domain"
import { generateText, Output } from "ai"
import { z } from "zod"
import { randomUUID } from "crypto"

// Per-click execution caps. Tuned for Vercel Functions' 300s default.
// Concurrency 3 keeps the AI Gateway free-tier RPM headroom comfortable
// (~12 RPM/model in the worst case).
export const CARD_GEN_HARD_CAP = 50
export const CARD_GEN_CONCURRENCY = 3

// Truncation guard: a single source item that exceeds this length gets
// clipped before going to the LLM. 120k chars (~30k tokens) matches the
// office parser's guard. Beyond that, even Gemini 1M-context starts to
// reason worse.
const MAX_MARKDOWN_CHARS = 120_000

// Output schema enforced via Output.object — independent of what the rule
// prompt says. The rule's `content` is the *guidance*; the *shape* is owned
// here so a rule writer can't inadvertently break ingestion.
//
// All fields are REQUIRED with no `.optional()` / `.nullable()` — those get
// translated by Zod-to-JSON-Schema into `anyOf`/`oneOf` clauses, and Gemini's
// structured-output engine rejects schemas containing union-typed fields
// ("Invalid value at one_of[…]"). When the model decides the source isn't
// relevant, it sets `relevant: false` and fills the rest with sentinel
// values (any priority, any category, empty strings, empty arrays); we
// throw those away in the not-relevant branch.
const cardOutputSchema = z.object({
  relevant: z.boolean(),
  priority: z.enum(["normal", "high"]),
  // Accept upper-snake from the rule prompt; we normalize to enum below.
  // Tolerate the legacy spelling (`COLLEAGUES_UPDATE`) that appeared in
  // the original example prompt.
  category: z.enum([
    "CLIENT_ACTIVITY",
    "COLLEAGUES_ACTIVITY",
    "BUSINESS_INFO",
    "COLLEAGUES_UPDATE",
    "ACTION_REQUIRED",
    "AMBIGUITY",
    "DATA_INTELLIGENCE",
    "MOMENTUM",
    "LOG_ONLY",
    "NEW_ORDER",
    "SUPPORT",
  ]),
  message: z.object({
    analysis: z.string(),
    recommendation: z.string(),
  }),
  // A concise, action-oriented task title (3-5 words) summarising what the
  // operator should DO about this card — used to prefill the task name when
  // they click "Принять". Same language as analysis/recommendation.
  taskTitle: z.string(),
  clients: z.array(z.string()),
  users: z.array(z.string()),
})

function normaliseCategory(c: string): CardCategory {
  switch (c) {
    case "CLIENT_ACTIVITY":
      return "client_activity"
    case "BUSINESS_INFO":
      return "business_info"
    case "COLLEAGUES_ACTIVITY":
    case "COLLEAGUES_UPDATE":
      return "colleagues_activity"
    case "ACTION_REQUIRED":
      return "action_required"
    case "AMBIGUITY":
      return "ambiguity"
    case "DATA_INTELLIGENCE":
      return "data_intelligence"
    case "MOMENTUM":
      return "momentum"
    case "LOG_ONLY":
      return "log_only"
    case "NEW_ORDER":
      return "new_order"
    case "SUPPORT":
      return "support"
    default:
      throw new Error(`Unmapped category: ${c}`)
  }
}

function normaliseName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

// --- Conversation grouping -------------------------------------------------
// Provider thread ids (Gmail threadId / Chat thread) are the precise signal,
// but real CRM inboxes routinely break a logical conversation across several
// provider threads (a "Re:" composed as a fresh email gets a brand-new
// threadId). So a card's "history" is keyed primarily on the EXTERNAL
// contact (the non-own-domain participant) and secondarily on the provider
// thread — either shared key links two messages into one conversation.

// How far back to look for prior messages of the same conversation.
const HISTORY_LOOKBACK_DAYS = 180
// Cap prior messages fed as context per card (most-recent first), and clip
// each summary so a long history can't blow the context budget.
const MAX_HISTORY_MESSAGES = 12
const MAX_HISTORY_SUMMARY_CHARS = 600

type EmailParty = { name?: string | null; email?: string | null }

function partyEmails(meta: Record<string, unknown>): EmailParty[] {
  const out: EmailParty[] = []
  for (const key of ["from", "to", "cc", "bcc"]) {
    const v = meta[key]
    if (Array.isArray(v)) {
      for (const p of v) {
        if (p && typeof p === "object" && "email" in p) {
          out.push(p as EmailParty)
        }
      }
    }
  }
  // Fallback for providers that store participants instead of from/to.
  const participants = meta["participants"]
  if (Array.isArray(participants)) {
    for (const p of participants) {
      if (p && typeof p === "object" && "email" in p) out.push(p as EmailParty)
    }
  }
  return out
}

// The external participant's email for an item — the contact who reached out.
// Walks from/to/cc/bcc/participants in order (so `from`, the sender, wins) and
// returns the first address NOT on one of the owner's own domains. Null when
// the item has no external email party (e.g. Telegram DMs carry no email).
function externalContactEmail(
  meta: Record<string, unknown>,
  ownOrg: OwnOrgIdentity,
): string | null {
  for (const p of partyEmails(meta)) {
    const email = (p.email ?? "").trim().toLowerCase()
    if (!email) continue
    if (ownOrg.isOwnDomain(extractEmailDomain(email))) continue
    return email
  }
  return null
}

// Keys under which an item participates in a conversation. Two items belong
// to the same conversation if they share ANY key.
function conversationKeys(
  threadExternalId: string | null,
  meta: Record<string, unknown>,
  ownOrg: OwnOrgIdentity,
): string[] {
  const keys: string[] = []
  if (threadExternalId) keys.push(`thread:${threadExternalId}`)
  for (const p of partyEmails(meta)) {
    const email = (p.email ?? "").trim().toLowerCase()
    if (!email) continue
    // Only EXTERNAL parties anchor a conversation — the owner's own mailbox is
    // on (almost) every message and would merge unrelated threads.
    if (ownOrg.isOwnDomain(extractEmailDomain(email))) continue
    keys.push(`contact:${email}`)
  }
  return Array.from(new Set(keys))
}

type HistoryEntry = {
  id: string
  sourceCreatedAt: Date | null
  subject: string
  sender: string
  summary: string
}

function metaSubject(meta: Record<string, unknown>): string {
  const s = meta["subject"]
  return typeof s === "string" ? s : ""
}

function metaSenderLabel(meta: Record<string, unknown>): string {
  const from = meta["from"]
  if (Array.isArray(from) && from[0] && typeof from[0] === "object") {
    const p = from[0] as EmailParty
    return p.name?.trim() || p.email?.trim() || "unknown"
  }
  return "unknown"
}

function metaSummary(meta: Record<string, unknown>): string {
  const s = meta["summary"]
  return typeof s === "string" ? s : ""
}

export type GenerateCardsInput = {
  from: string | null
  to: string | null
  sourceIds: string[] | null
  ruleId: string
  modelKey: string
  // When false (default), the pipeline only sees items the previous run
  // hasn't analyzed yet (or has been re-parsed since). When true, it
  // ignores `cardAnalysisScannedAt` entirely — for ad-hoc re-runs.
  includeAlreadyAnalyzed?: boolean
}

export type GenerateCardsResult = {
  scanned: number
  cardsCreated: number
  skippedNotRelevant: number
  skippedNoMarkdown: number
  failed: number
  capped: number
  errors: { sourceItemId: string; message: string }[]
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

// Bounded concurrent map. Returns results in input order; failures are
// captured in-place rather than rejecting the whole batch.
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

export async function previewCardGenerationCandidates(input: {
  from: string | null
  to: string | null
  sourceIds: string[] | null
  includeAlreadyAnalyzed?: boolean
}): Promise<{ count: number; cap: number }> {
  const { activeOrgId } = await requireOrgContext()
  const conditions = [
    eq(sourceItem.organizationId, activeOrgId),
    eq(sourceItem.parseStatus, "complete"),
    eq(sourceItem.r2UploadStatus, "complete"),
    isNotNull(sourceItem.markdownR2Key),
  ]
  if (!input.includeAlreadyAnalyzed) {
    const notYetAnalyzed = or(
      isNull(sourceItem.cardAnalysisScannedAt),
      sql`${sourceItem.parsedAt} > ${sourceItem.cardAnalysisScannedAt}`,
    )
    if (notYetAnalyzed) conditions.push(notYetAnalyzed)
  }
  if (input.sourceIds && input.sourceIds.length > 0) {
    conditions.push(inArray(sourceItem.sourceId, input.sourceIds))
  }
  if (input.from) {
    const f = new Date(input.from)
    if (!Number.isNaN(f.getTime())) {
      conditions.push(gte(sourceItem.sourceCreatedAt, f))
    }
  }
  if (input.to) {
    const t = new Date(`${input.to}T23:59:59.999Z`)
    if (!Number.isNaN(t.getTime())) {
      conditions.push(lte(sourceItem.sourceCreatedAt, t))
    }
  }
  const rows = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .where(and(...conditions))
  return { count: rows.length, cap: CARD_GEN_HARD_CAP }
}

export async function generateCards(
  input: GenerateCardsInput,
): Promise<GenerateCardsResult> {
  const { activeOrgId } = await requireOrgContext()

  // 1. Resolve + scope the rule.
  const ruleRows = await db
    .select()
    .from(rule)
    .where(eq(rule.id, input.ruleId))
    .limit(1)
  const ruleRow = ruleRows[0]
  if (!ruleRow) throw new Error("Rule not found")
  if (ruleRow.organizationId !== activeOrgId) throw new Error("Unauthorized")
  if (ruleRow.isDeleted) throw new Error("Rule is deleted")

  // 2. Resolve + scope sources (if specified).
  if (input.sourceIds && input.sourceIds.length > 0) {
    const owned = await db
      .select({ id: source.id, ownerOrganizationId: source.ownerOrganizationId })
      .from(source)
      .where(inArray(source.id, input.sourceIds))
    if (owned.length !== input.sourceIds.length) {
      throw new Error("Invalid source reference")
    }
    for (const s of owned) {
      if (s.ownerOrganizationId !== activeOrgId) {
        throw new Error("Invalid source reference")
      }
    }
  }

  // 3. Pull candidate source items in scope. Eligibility: parsed AND
  //    uploaded to R2 (so the markdown is canonical). By default also
  //    skips items already analyzed by a previous run — bypassed when
  //    `includeAlreadyAnalyzed` is set.
  const itemConditions = [
    eq(sourceItem.organizationId, activeOrgId),
    eq(sourceItem.parseStatus, "complete"),
    eq(sourceItem.r2UploadStatus, "complete"),
    isNotNull(sourceItem.markdownR2Key),
  ]
  if (!input.includeAlreadyAnalyzed) {
    const notYetAnalyzed = or(
      isNull(sourceItem.cardAnalysisScannedAt),
      sql`${sourceItem.parsedAt} > ${sourceItem.cardAnalysisScannedAt}`,
    )
    if (notYetAnalyzed) itemConditions.push(notYetAnalyzed)
  }
  if (input.sourceIds && input.sourceIds.length > 0) {
    itemConditions.push(inArray(sourceItem.sourceId, input.sourceIds))
  }
  if (input.from) {
    const f = new Date(input.from)
    if (!Number.isNaN(f.getTime())) {
      itemConditions.push(gte(sourceItem.sourceCreatedAt, f))
    }
  }
  if (input.to) {
    const t = new Date(`${input.to}T23:59:59.999Z`)
    if (!Number.isNaN(t.getTime())) {
      itemConditions.push(lte(sourceItem.sourceCreatedAt, t))
    }
  }

  const allCandidates = await db
    .select({
      id: sourceItem.id,
      markdownR2Key: sourceItem.markdownR2Key,
      filename: sourceItem.filename,
      externalId: sourceItem.externalId,
      provider: source.provider,
      sourceCreatedAt: sourceItem.sourceCreatedAt,
      threadExternalId: sourceItem.threadExternalId,
      metadataJson: sourceItem.metadataJson,
    })
    .from(sourceItem)
    .innerJoin(source, eq(sourceItem.sourceId, source.id))
    .where(and(...itemConditions))
    .orderBy(desc(sourceItem.sourceCreatedAt))

  const capped = Math.max(0, allCandidates.length - CARD_GEN_HARD_CAP)
  const candidates = allCandidates.slice(0, CARD_GEN_HARD_CAP)

  // 4. Reference data passed to every LLM call.
  const orgClients = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(
      and(eq(client.organizationId, activeOrgId), eq(client.status, "active")),
    )
  const orgUsers = await db
    .select({ id: user.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, activeOrgId))

  // Contacts with an email, keyed by lowercased email so a card can be linked
  // to the external sender deterministically (no LLM name-matching for
  // contacts — email is authoritative, same posture as discovery).
  const orgContacts = await db
    .select({ id: contact.id, email: contact.email })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, activeOrgId),
        inArray(contact.status, ["active", "initial"]),
        isNotNull(contact.email),
      ),
    )
  const contactByEmail = new Map(
    orgContacts
      .filter((c) => c.email)
      .map((c) => [c.email!.trim().toLowerCase(), c.id]),
  )

  const clientByName = new Map(orgClients.map((c) => [normaliseName(c.name), c.id]))
  const userByName = new Map(orgUsers.map((u) => [normaliseName(u.name), u.id]))

  const clientList = orgClients.map((c) => c.name).join("\n- ")
  const userList = orgUsers.map((u) => u.name).join("\n- ")

  // 4b. Conversation history index. Pull every parsed root item for the org
  //     within the lookback window, key each by its conversation keys, so the
  //     per-card loop can assemble the prior messages of the same conversation
  //     as context (summaries only — cheap, no extra R2 reads).
  const ownOrg = await loadOwnOrgIdentity(activeOrgId)
  const historyCutoff = new Date(
    Date.now() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  )
  const historyRows = await db
    .select({
      id: sourceItem.id,
      sourceCreatedAt: sourceItem.sourceCreatedAt,
      threadExternalId: sourceItem.threadExternalId,
      metadataJson: sourceItem.metadataJson,
    })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.organizationId, activeOrgId),
        eq(sourceItem.parseStatus, "complete"),
        isNull(sourceItem.parentSourceItemId),
        gte(sourceItem.sourceCreatedAt, historyCutoff),
      ),
    )

  // key -> entries (unsorted; sorted + filtered per card at use time).
  const historyIndex = new Map<string, HistoryEntry[]>()
  for (const row of historyRows) {
    const meta = (row.metadataJson ?? {}) as Record<string, unknown>
    const subject = metaSubject(meta)
    // Items without a subject (attachments slipped through, non-email kinds)
    // carry no useful conversational summary line — skip them as history.
    if (!subject && !metaSummary(meta)) continue
    const entry: HistoryEntry = {
      id: row.id,
      sourceCreatedAt: row.sourceCreatedAt,
      subject,
      sender: metaSenderLabel(meta),
      summary: metaSummary(meta),
    }
    for (const key of conversationKeys(row.threadExternalId, meta, ownOrg)) {
      const list = historyIndex.get(key)
      if (list) list.push(entry)
      else historyIndex.set(key, [entry])
    }
  }

  // Assemble the prior-conversation block for one candidate. Returns the
  // rendered markdown (empty when there's no prior history) + a count.
  function buildHistoryForItem(item: {
    id: string
    sourceCreatedAt: Date | null
    threadExternalId: string | null
    metadataJson: unknown
  }): { historyMarkdown: string; priorCount: number } {
    const meta = (item.metadataJson ?? {}) as Record<string, unknown>
    const keys = conversationKeys(item.threadExternalId, meta, ownOrg)
    const byId = new Map<string, HistoryEntry>()
    for (const key of keys) {
      for (const e of historyIndex.get(key) ?? []) {
        if (e.id === item.id) continue
        // Strictly prior in time. Ties (same timestamp) are treated as not
        // prior to avoid a message pairing with its own resync duplicate.
        const a = e.sourceCreatedAt?.getTime() ?? 0
        const b = item.sourceCreatedAt?.getTime() ?? 0
        if (a >= b) continue
        byId.set(e.id, e)
      }
    }
    if (byId.size === 0) return { historyMarkdown: "", priorCount: 0 }
    const sorted = Array.from(byId.values()).sort(
      (x, y) =>
        (x.sourceCreatedAt?.getTime() ?? 0) -
        (y.sourceCreatedAt?.getTime() ?? 0),
    )
    // Keep the most-recent MAX_HISTORY_MESSAGES, then render oldest→newest.
    const kept = sorted.slice(-MAX_HISTORY_MESSAGES)
    const lines = kept.map((e) => {
      const when = e.sourceCreatedAt?.toISOString().slice(0, 16) ?? "unknown"
      const summary =
        e.summary.length > MAX_HISTORY_SUMMARY_CHARS
          ? e.summary.slice(0, MAX_HISTORY_SUMMARY_CHARS) + "…"
          : e.summary || "(no summary)"
      return `- [${when}] from ${e.sender} · subject: "${e.subject || "(none)"}"\n  ${summary}`
    })
    return { historyMarkdown: lines.join("\n"), priorCount: kept.length }
  }

  const gatewayId = getGatewayId(input.modelKey)

  const result: GenerateCardsResult = {
    scanned: 0,
    cardsCreated: 0,
    skippedNotRelevant: 0,
    skippedNoMarkdown: 0,
    failed: 0,
    capped,
    errors: [],
  }

  // Items the LLM reached a definitive verdict on (or that had empty
  // markdown). Stamped at the end so the next default run skips them.
  // R2-read failures and LLM throws are NOT collected here — they're
  // transient and should retry next time.
  const itemIdsToStamp: string[] = []

  // 5. Per-item LLM call, bounded concurrency. Each result either
  //    inserts one card or counts as skipped/failed; the whole batch
  //    never fails as a unit.
  console.log(
    `[generate-cards] starting batch · candidates=${candidates.length} ` +
      `cap=${CARD_GEN_HARD_CAP} concurrency=${CARD_GEN_CONCURRENCY} ` +
      `model=${input.modelKey}`,
  )
  await mapWithConcurrency(candidates, CARD_GEN_CONCURRENCY, async (item) => {
    result.scanned++
    let markdown = ""
    try {
      markdown = await getMarkdownFromR2(item.markdownR2Key!)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[generate-cards] ${item.id} · R2 read failed: ${msg}`)
      result.skippedNoMarkdown++
      result.errors.push({
        sourceItemId: item.id,
        message: `R2 read failed: ${msg}`,
      })
      return
    }
    if (!markdown.trim()) {
      result.skippedNoMarkdown++
      itemIdsToStamp.push(item.id)
      return
    }
    const truncated =
      markdown.length > MAX_MARKDOWN_CHARS
        ? markdown.slice(0, MAX_MARKDOWN_CHARS) + "\n\n[…truncated]"
        : markdown

    const { historyMarkdown, priorCount } = buildHistoryForItem(item)

    const prompt = buildPrompt({
      ruleContent: ruleRow.content,
      clientList,
      userList,
      provider: item.provider,
      title: item.filename ?? item.externalId,
      sourceCreatedAt: item.sourceCreatedAt?.toISOString() ?? "unknown",
      markdown: truncated,
      historyMarkdown,
      priorCount,
    })

    try {
      const { output } = await generateText({
        model: gatewayId,
        output: Output.object({ schema: cardOutputSchema }),
        system:
          "You are a precise sales-and-marketing analysis assistant. " +
          "You analyze a single source item under a user-supplied rule and " +
          "emit either { relevant: false } or one structured card. Never " +
          "fabricate facts; only return what is grounded in the source.",
        prompt,
      })

      if (!output.relevant) {
        result.skippedNotRelevant++
        itemIdsToStamp.push(item.id)
        return
      }

      const category = normaliseCategory(output.category)
      const priority: CardPriority = output.priority

      // Match emitted client/user names against the org's roster. Names that
      // don't match are dropped silently — the rule may surface entities the
      // operator hasn't created yet, and we'd rather skip than 500.
      const matchedClientIds = Array.from(
        new Set(
          output.clients
            .map((n) => clientByName.get(normaliseName(n)))
            .filter((x): x is string => Boolean(x)),
        ),
      )
      const matchedUserIds = Array.from(
        new Set(
          output.users
            .map((n) => userByName.get(normaliseName(n)))
            .filter((x): x is string => Boolean(x)),
        ),
      )

      // Resolve the related contact from the source item's external sender
      // email (deterministic — no LLM name match). Null when the item has no
      // external email party or the sender isn't a known contact.
      const itemMeta = (item.metadataJson ?? {}) as Record<string, unknown>
      const senderEmail = externalContactEmail(itemMeta, ownOrg)
      const matchedContactId = senderEmail
        ? contactByEmail.get(senderEmail) ?? null
        : null

      // For "new_order" cards, stamp the VERBATIM client message so the
      // card's "Create order" button can prefill the New Order dialog's
      // request field unchanged. Prefer the raw source text
      // (Telegram/WhatsApp `metadata_json.rawText` / `text`); fall back to the
      // parsed markdown only if no raw body exists (non-chat providers).
      let orderRequest: string | undefined
      if (category === "new_order") {
        const meta = (item.metadataJson ?? {}) as Record<string, unknown>
        const raw =
          typeof meta.rawText === "string" && meta.rawText.trim()
            ? meta.rawText
            : typeof meta.text === "string" && meta.text.trim()
              ? meta.text
              : truncated
        orderRequest = raw
      }

      const cardId = randomUUID()
      await db.insert(card).values({
        id: cardId,
        organizationId: activeOrgId,
        priority,
        category,
        message: {
          analysis: output.message.analysis ?? "",
          recommendation: output.message.recommendation ?? "",
          ...(orderRequest ? { orderRequest } : {}),
          ...(output.taskTitle?.trim()
            ? { taskTitle: output.taskTitle.trim() }
            : {}),
        },
        sourceItemId: item.id,
        ruleId: ruleRow.id,
      })
      if (matchedClientIds.length > 0) {
        await db
          .insert(cardClient)
          .values(matchedClientIds.map((cid) => ({ cardId, clientId: cid })))
      }
      if (matchedUserIds.length > 0) {
        await db
          .insert(cardUser)
          .values(matchedUserIds.map((uid) => ({ cardId, userId: uid })))
      }
      if (matchedContactId) {
        await db
          .insert(cardContact)
          .values({ cardId, contactId: matchedContactId })
      }
      result.cardsCreated++
      itemIdsToStamp.push(item.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[generate-cards] ${item.id} · LLM/insert failed: ${msg}`)
      result.failed++
      result.errors.push({
        sourceItemId: item.id,
        message: msg,
      })
    }
  })

  // Single batched stamp — one DB round-trip regardless of batch size.
  // Stamps only items the LLM definitively considered this run; transient
  // failures (R2 read, LLM throw) are NOT in this list, so they retry next
  // run.
  if (itemIdsToStamp.length > 0) {
    await db
      .update(sourceItem)
      .set({ cardAnalysisScannedAt: new Date() })
      .where(inArray(sourceItem.id, itemIdsToStamp))
  }

  console.log(
    `[generate-cards] done · scanned=${result.scanned} ` +
      `created=${result.cardsCreated} ` +
      `notRelevant=${result.skippedNotRelevant} ` +
      `noMarkdown=${result.skippedNoMarkdown} ` +
      `failed=${result.failed} capped=${result.capped}`,
  )

  // Cap the error tail so a catastrophic batch doesn't bloat the response.
  if (result.errors.length > 30) {
    result.errors = result.errors.slice(0, 30)
  }
  return result
}

function buildPrompt(args: {
  ruleContent: string
  clientList: string
  userList: string
  provider: string
  title: string
  sourceCreatedAt: string
  markdown: string
  historyMarkdown: string
  priorCount: number
}): string {
  const isFollowUp = args.priorCount > 0
  const historySection = isFollowUp
    ? `# CONVERSATION HISTORY (context only — do NOT re-summarize)
This is a FOLLOW-UP message. ${args.priorCount} earlier message(s) of the same
conversation are listed below, oldest → newest, as short summaries. Use them
ONLY to interpret what the LATEST message changes. Do not repeat their content
in the card unless it is needed to explain why the latest signal matters.

${args.historyMarkdown}
`
    : `# CONVERSATION HISTORY
None — this is the FIRST message we have in this conversation. Analyze it as an
initial inbound signal.
`

  return `# RULE
${args.ruleContent}

# REFERENCE DATA

## Known clients in this organization
${args.clientList ? `- ${args.clientList}` : "(none)"}

## Known users in this organization
${args.userList ? `- ${args.userList}` : "(none)"}

# OUTPUT CONTRACT
Return JSON matching this exact shape (every field is required):

  {
    "relevant": boolean,
    "priority": "normal" | "high",
    "category": "CLIENT_ACTIVITY" | "COLLEAGUES_ACTIVITY" | "BUSINESS_INFO" | "ACTION_REQUIRED" | "AMBIGUITY" | "DATA_INTELLIGENCE" | "MOMENTUM" | "LOG_ONLY" | "NEW_ORDER" | "SUPPORT",
    "message": { "analysis": "...", "recommendation": "..." },
    "taskTitle": "...",   // concise 3-5 word action-oriented task title (same language as the message); summarises what to DO
    "clients": ["..."],   // names from the Known clients list above; [] if none match
    "users":   ["..."]    // names from the Known users list above;   [] if none match
  }

Rules:
- If the source is RELEVANT per the rule's case definitions, set relevant=true and fill all fields meaningfully.
- "taskTitle" must be a specific 3-5 word imperative summary of the recommended action (e.g. "Перезвонить клиенту по оплате"), NOT the category name. Make it meaningful and distinct per card.
- If the source is NOT relevant (e.g. the rule's Case 8 / discard case), set relevant=false and use placeholder values for the rest:
    priority: "normal", category: "BUSINESS_INFO",
    message: { "analysis": "", "recommendation": "" },
    taskTitle: "", clients: [], users: []
  Those placeholders are ignored on the server when relevant=false.
- Never return null, never omit a field.

${historySection}
# LATEST MESSAGE (analyze THIS — emit the card about what it changes)
- Provider: ${args.provider}
- Title: ${args.title}
- Source created: ${args.sourceCreatedAt}
- Is follow-up: ${isFollowUp ? `yes (${args.priorCount} prior message(s))` : "no (first message)"}

## Markdown
${args.markdown}
`
}
