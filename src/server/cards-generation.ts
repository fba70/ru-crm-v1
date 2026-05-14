import "server-only"

import { db } from "@/db/drizzle"
import {
  card,
  cardClient,
  cardUser,
  client,
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
  ]),
  message: z.object({
    analysis: z.string(),
    recommendation: z.string(),
  }),
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
    default:
      throw new Error(`Unmapped category: ${c}`)
  }
}

function normaliseName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
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

  const clientByName = new Map(orgClients.map((c) => [normaliseName(c.name), c.id]))
  const userByName = new Map(orgUsers.map((u) => [normaliseName(u.name), u.id]))

  const clientList = orgClients.map((c) => c.name).join("\n- ")
  const userList = orgUsers.map((u) => u.name).join("\n- ")

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
      console.log(`[generate-cards] ${item.id} · empty markdown — skipped`)
      result.skippedNoMarkdown++
      itemIdsToStamp.push(item.id)
      return
    }
    const truncated =
      markdown.length > MAX_MARKDOWN_CHARS
        ? markdown.slice(0, MAX_MARKDOWN_CHARS) + "\n\n[…truncated]"
        : markdown

    const prompt = buildPrompt({
      ruleContent: ruleRow.content,
      clientList,
      userList,
      provider: item.provider,
      title: item.filename ?? item.externalId,
      sourceCreatedAt: item.sourceCreatedAt?.toISOString() ?? "unknown",
      markdown: truncated,
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
        console.log(
          `[generate-cards] ${item.id} · not relevant per rule — skipped`,
        )
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

      const cardId = randomUUID()
      await db.insert(card).values({
        id: cardId,
        organizationId: activeOrgId,
        priority,
        category,
        message: {
          analysis: output.message.analysis ?? "",
          recommendation: output.message.recommendation ?? "",
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
      console.log(
        `[generate-cards] ${item.id} · card created (priority=${priority} ` +
          `category=${category} clients=${matchedClientIds.length} ` +
          `users=${matchedUserIds.length})`,
      )
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
}): string {
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
    "category": "CLIENT_ACTIVITY" | "COLLEAGUES_ACTIVITY" | "BUSINESS_INFO",
    "message": { "analysis": "...", "recommendation": "..." },
    "clients": ["..."],   // names from the Known clients list above; [] if none match
    "users":   ["..."]    // names from the Known users list above;   [] if none match
  }

Rules:
- If the source is RELEVANT per the rule's case definitions, set relevant=true and fill all fields meaningfully.
- If the source is NOT relevant (e.g. the rule's Case 8 / discard case), set relevant=false and use placeholder values for the rest:
    priority: "normal", category: "BUSINESS_INFO",
    message: { "analysis": "", "recommendation": "" },
    clients: [], users: []
  Those placeholders are ignored on the server when relevant=false.
- Never return null, never omit a field.

# SOURCE ITEM
- Provider: ${args.provider}
- Title: ${args.title}
- Source created: ${args.sourceCreatedAt}

## Markdown
${args.markdown}
`
}
