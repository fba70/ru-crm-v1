import "server-only"

import { db } from "@/db/drizzle"
import {
  client,
  contact,
  deal,
  dealContact,
  dealFunnelStage,
  rule,
  source,
  sourceItem,
} from "@/db/schema"
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { getMarkdownFromR2 } from "@/lib/r2"
import { getGatewayId } from "@/lib/llm-models"
import { generateText, Output } from "ai"
import { z } from "zod"
import { randomUUID } from "crypto"

// Per-click execution caps. Same shape as cards-generation; tuned for the
// 300s function timeout and the AI Gateway's free-tier RPM headroom.
export const DEAL_DISCOVERY_HARD_CAP = 50
export const DEAL_DISCOVERY_CONCURRENCY = 3

// Truncation guard, matches cards-generation.
const MAX_MARKDOWN_CHARS = 120_000

// LLM output schema. All fields REQUIRED with sentinel values for the
// branches the chosen `action` doesn't touch — Gemini's structured output
// can't handle nullable / oneOf union fields. The server discards
// branch-irrelevant fields based on `action`.
const dealOutputSchema = z.object({
  relevant: z.boolean(),
  action: z.enum(["CREATE", "UPDATE_STAGE", "SKIP"]),

  // CREATE branch
  newDealName: z.string(),
  newDealDescription: z.string(),
  newDealClientName: z.string(),
  newDealStageName: z.string(),
  newDealValue: z.number(),
  newDealCurrency: z.string(),
  newDealContactNames: z.array(z.string()),

  // UPDATE_STAGE branch
  matchedDealName: z.string(),
  updatedStageName: z.string(),
  // What changed on this stage move, based on the new source signal — a
  // short description that's logged on the deal WITHOUT rewriting its
  // original description. Empty string for CREATE / SKIP.
  changes: z.string(),

  // One-sentence rationale for the action (create or stage move).
  reasoning: z.string(),
})

function normaliseName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

function normaliseCurrency(c: string): string {
  const raw = c.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(raw) ? raw : ""
}

export type GenerateDealsInput = {
  from: string | null
  to: string | null
  sourceIds: string[] | null
  ruleId: string
  modelKey: string
  // When false (default), the pipeline only sees items the previous run
  // hasn't analyzed yet (or has been re-parsed since). When true, it
  // ignores `dealAnalysisScannedAt` entirely.
  includeAlreadyAnalyzed?: boolean
  // Dry run: run the LLM and compute every decision (counters + planned
  // actions) but write NOTHING — no deal/contact inserts, no stage updates,
  // and crucially no `dealAnalysisScannedAt` stamp, so the same items stay
  // eligible. The rule-testing workflow: iterate rule wording with dry-run
  // until happy, then run for real.
  dryRun?: boolean
}

/** One would-be action, returned only on dry runs so the dialog can show
 *  what the rule WOULD do without committing. */
export type PlannedDealAction = {
  sourceItemId: string
  action: "CREATE" | "UPDATE_STAGE"
  dealName: string
  clientName: string | null
  stageName: string | null
  reasoning: string
}

export type GenerateDealsResult = {
  scanned: number
  dealsCreated: number
  stageUpdates: number
  skippedNotRelevant: number
  skippedNoMarkdown: number
  skippedUnknownClient: number
  skippedUnknownStage: number
  skippedUnknownDeal: number
  // A CREATE whose (client + normalised name) already matches a non-deleted
  // deal — dropped to avoid duplicates (a `deleted` deal never blocks, so a
  // fresh re-scan can re-create it).
  skippedDuplicate: number
  failed: number
  capped: number
  // True when this was a dry run (no writes, no stamps).
  dryRun: boolean
  // Populated only on dry runs: the CREATE / UPDATE_STAGE decisions.
  plannedActions: PlannedDealAction[]
  errors: { sourceItemId: string; message: string }[]
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = cursor++
        if (i >= items.length) return
        results[i] = await worker(items[i], i)
      }
    },
  )
  await Promise.all(runners)
  return results
}

export async function previewDealDiscoveryCandidates(input: {
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
      isNull(sourceItem.dealAnalysisScannedAt),
      sql`${sourceItem.parsedAt} > ${sourceItem.dealAnalysisScannedAt}`,
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
  return { count: rows.length, cap: DEAL_DISCOVERY_HARD_CAP }
}

export async function generateDeals(
  input: GenerateDealsInput,
): Promise<GenerateDealsResult> {
  const { session, activeOrgId } = await requireOrgContext()

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
      .select({
        id: source.id,
        ownerOrganizationId: source.ownerOrganizationId,
      })
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

  // 3. Pull candidate source items.
  const itemConditions = [
    eq(sourceItem.organizationId, activeOrgId),
    eq(sourceItem.parseStatus, "complete"),
    eq(sourceItem.r2UploadStatus, "complete"),
    isNotNull(sourceItem.markdownR2Key),
  ]
  if (!input.includeAlreadyAnalyzed) {
    const notYetAnalyzed = or(
      isNull(sourceItem.dealAnalysisScannedAt),
      sql`${sourceItem.parsedAt} > ${sourceItem.dealAnalysisScannedAt}`,
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

  const capped = Math.max(0, allCandidates.length - DEAL_DISCOVERY_HARD_CAP)
  const candidates = allCandidates.slice(0, DEAL_DISCOVERY_HARD_CAP)

  // 4. Reference data: clients (active+initial), contacts (active+initial),
  //    open deals (non-cancelled, 0 < probability < 1), funnel stages
  //    (org-or-system fallback consistent with the rest of the app).
  const orgClients = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        // Match the picker scope used elsewhere — `active` + `initial`,
        // exclude `suspended`.
        or(eq(client.status, "active"), eq(client.status, "initial"))!,
      ),
    )
    .orderBy(client.name)

  const orgContacts = await db
    .select({
      id: contact.id,
      name: contact.name,
      clientId: contact.clientId,
    })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, activeOrgId),
        or(eq(contact.status, "active"), eq(contact.status, "initial"))!,
      ),
    )
    .orderBy(contact.name)

  // Open deals: not cancelled, not on a terminal stage. Probability bounds
  // are robust to org-customised stage names (a custom funnel can rename
  // "Closed" / "Rejected" but the 1.0 / 0.0 probabilities still mark
  // terminals).
  const openDeals = await db
    .select({
      id: deal.id,
      name: deal.name,
      description: deal.description,
      clientId: deal.clientId,
      clientName: client.name,
      stageId: deal.funnelStageId,
      stageName: dealFunnelStage.name,
      probability: dealFunnelStage.closureProbability,
    })
    .from(deal)
    .innerJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
    .leftJoin(client, eq(deal.clientId, client.id))
    .where(
      and(
        eq(deal.organizationId, activeOrgId),
        // Only active deals are match targets — cancelled / deleted are
        // soft-deleted and out of the identify/match/move logic entirely.
        eq(deal.status, "active"),
        sql`${dealFunnelStage.closureProbability} > 0`,
        sql`${dealFunnelStage.closureProbability} < 1`,
      ),
    )

  // Create-side dedup index: every non-deleted deal keyed by
  // `${clientId}::${normalisedName}`. A CREATE whose key already lives here
  // is dropped as a duplicate. `deleted` deals are deliberately excluded so
  // a fresh re-scan after marking the prior run's deals deleted re-creates
  // them cleanly. Seeded from the DB, then grown in-memory as this run
  // creates deals so same-run duplicates are also caught.
  const existingDealRows = await db
    .select({ name: deal.name, clientId: deal.clientId })
    .from(deal)
    .where(
      and(
        eq(deal.organizationId, activeOrgId),
        ne(deal.status, "deleted"),
      ),
    )
  const dealDedupKey = (clientId: string, name: string) =>
    `${clientId}::${normaliseName(name)}`
  const existingDealKeys = new Set(
    existingDealRows.map((d) => dealDedupKey(d.clientId, d.name)),
  )

  // Funnel stages — same resolution as listDealFunnelStages: org-scoped
  // if any active org rows exist for this org, else system. Repeated here
  // (vs. importing the public function) because that one calls
  // requireOrgContext() and we already have the org id.
  const orgStages = await db
    .select({
      id: dealFunnelStage.id,
      name: dealFunnelStage.name,
      probability: dealFunnelStage.closureProbability,
      sortOrder: dealFunnelStage.sortOrder,
    })
    .from(dealFunnelStage)
    .where(
      and(
        eq(dealFunnelStage.isActive, true),
        eq(dealFunnelStage.isSystem, false),
        eq(dealFunnelStage.ownerOrganizationId, activeOrgId),
      ),
    )

  const systemStages = await db
    .select({
      id: dealFunnelStage.id,
      name: dealFunnelStage.name,
      probability: dealFunnelStage.closureProbability,
      sortOrder: dealFunnelStage.sortOrder,
    })
    .from(dealFunnelStage)
    .where(
      and(
        eq(dealFunnelStage.isActive, true),
        eq(dealFunnelStage.isSystem, true),
      ),
    )

  const stages = orgStages.length > 0 ? orgStages : systemStages

  // Lookup maps for normalised matching of LLM output.
  const clientByName = new Map(
    orgClients.map((c) => [normaliseName(c.name), c.id]),
  )
  const contactByName = new Map(
    orgContacts.map((c) => [normaliseName(c.name), c.id]),
  )
  const stageByName = new Map(
    stages.map((s) => [normaliseName(s.name), s.id]),
  )
  const openDealByName = new Map(
    openDeals.map((d) => [normaliseName(d.name), d.id]),
  )

  // Pre-format reference blocks for the prompt.
  const clientList = orgClients.map((c) => c.name).join("\n- ")
  const contactList = orgContacts
    .map((c) => {
      const linked = c.clientId
        ? orgClients.find((x) => x.id === c.clientId)?.name
        : null
      return linked ? `${c.name} (client: ${linked})` : c.name
    })
    .join("\n- ")
  // Open-deal format: name first, then current stage + closure probability
  // (lets the model reason about the direction of any proposed stage move),
  // then client, then truncated description. Multi-line per deal so the
  // rule prompt can refer to fields by their explicit labels — `name`,
  // `current stage`, `client`, `description`.
  const openDealList = openDeals
    .map((d) => {
      const probability = Number(d.probability)
      const probPct = Number.isFinite(probability)
        ? `${Math.round(probability * 100)}%`
        : "?"
      const lines = [
        `name: ${d.name}`,
        `  current stage: ${d.stageName} (closure probability: ${probPct})`,
        `  client: ${d.clientName ?? "?"}`,
      ]
      if (d.description) {
        lines.push(`  description: ${d.description.slice(0, 200)}`)
      }
      return lines.join("\n")
    })
    .join("\n- ")
  const stageList = stages
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(
      (s) => `${s.name} (closure probability: ${Number(s.probability)})`,
    )
    .join("\n- ")

  const gatewayId = getGatewayId(input.modelKey)

  const result: GenerateDealsResult = {
    scanned: 0,
    dealsCreated: 0,
    stageUpdates: 0,
    skippedNotRelevant: 0,
    skippedNoMarkdown: 0,
    skippedUnknownClient: 0,
    skippedUnknownStage: 0,
    skippedUnknownDeal: 0,
    skippedDuplicate: 0,
    failed: 0,
    capped,
    dryRun: input.dryRun === true,
    plannedActions: [],
    errors: [],
  }

  const itemIdsToStamp: string[] = []
  const dryRun = input.dryRun === true

  console.log(
    `[generate-deals] starting batch · candidates=${candidates.length} ` +
      `cap=${DEAL_DISCOVERY_HARD_CAP} concurrency=${DEAL_DISCOVERY_CONCURRENCY} ` +
      `model=${input.modelKey} dryRun=${dryRun}`,
  )

  await mapWithConcurrency(
    candidates,
    DEAL_DISCOVERY_CONCURRENCY,
    async (item) => {
      result.scanned++
      let markdown = ""
      try {
        markdown = await getMarkdownFromR2(item.markdownR2Key!)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`[generate-deals] ${item.id} · R2 read failed: ${msg}`)
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

      const prompt = buildPrompt({
        ruleContent: ruleRow.content,
        clientList,
        contactList,
        openDealList,
        stageList,
        provider: item.provider,
        title: item.filename ?? item.externalId,
        sourceCreatedAt: item.sourceCreatedAt?.toISOString() ?? "unknown",
        markdown: truncated,
      })

      try {
        const { output } = await generateText({
          model: gatewayId,
          output: Output.object({ schema: dealOutputSchema }),
          system:
            "You are a precise sales-pipeline analysis assistant. " +
            "You analyze a single source item under a user-supplied rule " +
            "and emit ONE structured action: create a new deal, update an " +
            "existing deal's funnel stage, or skip. Never fabricate clients, " +
            "contacts, deals, or stages — only reference names from the " +
            "provided lists.",
          prompt,
        })

        if (!output.relevant || output.action === "SKIP") {
          result.skippedNotRelevant++
          itemIdsToStamp.push(item.id)
          return
        }

        if (output.action === "CREATE") {
          const clientId = clientByName.get(
            normaliseName(output.newDealClientName),
          )
          if (!clientId) {
            result.skippedUnknownClient++
            result.errors.push({
              sourceItemId: item.id,
              message: `unknown client: "${output.newDealClientName}"`,
            })
            itemIdsToStamp.push(item.id)
            return
          }
          const stageId = stageByName.get(
            normaliseName(output.newDealStageName),
          )
          if (!stageId) {
            result.skippedUnknownStage++
            result.errors.push({
              sourceItemId: item.id,
              message: `unknown stage: "${output.newDealStageName}"`,
            })
            itemIdsToStamp.push(item.id)
            return
          }

          const matchedContactIds = Array.from(
            new Set(
              output.newDealContactNames
                .map((n) => contactByName.get(normaliseName(n)))
                .filter((x): x is string => Boolean(x)),
            ),
          )

          const trimmedName = output.newDealName.trim()
          if (!trimmedName) {
            result.skippedNotRelevant++
            itemIdsToStamp.push(item.id)
            return
          }

          // Create-side dedup: skip if a non-deleted deal with the same
          // client + normalised name already exists (seeded from DB, grown
          // in-memory below to also catch same-run duplicates). Adding the
          // key BEFORE any await closes the check-then-act race between the
          // concurrent workers.
          const dedupKey = dealDedupKey(clientId, trimmedName)
          if (existingDealKeys.has(dedupKey)) {
            result.skippedDuplicate++
            result.errors.push({
              sourceItemId: item.id,
              message: `duplicate deal: "${trimmedName}" for this client`,
            })
            itemIdsToStamp.push(item.id)
            return
          }
          existingDealKeys.add(dedupKey)

          const safeValue =
            Number.isFinite(output.newDealValue) && output.newDealValue > 0
              ? output.newDealValue.toFixed(2)
              : null
          const safeCurrency = normaliseCurrency(output.newDealCurrency) || "EUR"

          if (dryRun) {
            result.plannedActions.push({
              sourceItemId: item.id,
              action: "CREATE",
              dealName: trimmedName,
              clientName: output.newDealClientName.trim() || null,
              stageName: output.newDealStageName.trim() || null,
              reasoning: output.reasoning.trim(),
            })
            result.dealsCreated++
            // No stamp — dry runs leave items eligible for the next pass.
            return
          }

          const dealId = randomUUID()
          const now = new Date()

          await db.insert(deal).values({
            id: dealId,
            name: trimmedName,
            description: output.newDealDescription.trim() || null,
            // Why the deal was created. `changes` stays null on creation —
            // it only logs subsequent stage-move signals.
            reasoning: output.reasoning.trim() || null,
            changes: null,
            funnelStageId: stageId,
            clientId,
            value: safeValue,
            currency: safeCurrency,
            status: "active",
            userId: session.user.id,
            organizationId: activeOrgId,
            createdAt: now,
            updatedAt: now,
          })

          if (matchedContactIds.length > 0) {
            await db
              .insert(dealContact)
              .values(
                matchedContactIds.map((contactId) => ({
                  dealId,
                  contactId,
                })),
              )
          }

          result.dealsCreated++
          itemIdsToStamp.push(item.id)
          return
        }

        // UPDATE_STAGE branch
        const matchedDealId = openDealByName.get(
          normaliseName(output.matchedDealName),
        )
        if (!matchedDealId) {
          result.skippedUnknownDeal++
          result.errors.push({
            sourceItemId: item.id,
            message: `unknown matched deal: "${output.matchedDealName}"`,
          })
          itemIdsToStamp.push(item.id)
          return
        }
        const newStageId = stageByName.get(
          normaliseName(output.updatedStageName),
        )
        if (!newStageId) {
          result.skippedUnknownStage++
          result.errors.push({
            sourceItemId: item.id,
            message: `unknown stage: "${output.updatedStageName}"`,
          })
          itemIdsToStamp.push(item.id)
          return
        }

        if (dryRun) {
          result.plannedActions.push({
            sourceItemId: item.id,
            action: "UPDATE_STAGE",
            dealName: output.matchedDealName.trim(),
            clientName: null,
            stageName: output.updatedStageName.trim() || null,
            reasoning: output.reasoning.trim(),
          })
          result.stageUpdates++
          // No stamp on dry runs.
          return
        }

        await db
          .update(deal)
          .set({
            funnelStageId: newStageId,
            // Refresh the rationale + log what changed; the deal's
            // `description` is deliberately left untouched.
            reasoning: output.reasoning.trim() || null,
            changes: output.changes.trim() || null,
            // LLM-discovery — агентский перевод (бейдж «перевёл агент»).
            lastMovedBy: "agent",
          })
          .where(eq(deal.id, matchedDealId))

        result.stageUpdates++
        itemIdsToStamp.push(item.id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(
          `[generate-deals] ${item.id} · LLM/insert failed: ${msg}`,
        )
        result.failed++
        result.errors.push({
          sourceItemId: item.id,
          message: msg,
        })
      }
    },
  )

  // Dry runs never stamp — the whole point is to leave items eligible so the
  // operator can iterate on the rule and re-run against the same set.
  if (!dryRun && itemIdsToStamp.length > 0) {
    await db
      .update(sourceItem)
      .set({ dealAnalysisScannedAt: new Date() })
      .where(inArray(sourceItem.id, itemIdsToStamp))
  }

  console.log(
    `[generate-deals] done · scanned=${result.scanned} ` +
      `created=${result.dealsCreated} stageUpdates=${result.stageUpdates} ` +
      `notRelevant=${result.skippedNotRelevant} ` +
      `noMarkdown=${result.skippedNoMarkdown} ` +
      `unknownClient=${result.skippedUnknownClient} ` +
      `unknownStage=${result.skippedUnknownStage} ` +
      `unknownDeal=${result.skippedUnknownDeal} ` +
      `duplicate=${result.skippedDuplicate} ` +
      `failed=${result.failed} capped=${result.capped} ` +
      `dryRun=${result.dryRun}`,
  )

  if (result.errors.length > 30) {
    result.errors = result.errors.slice(0, 30)
  }
  return result
}

function buildPrompt(args: {
  ruleContent: string
  clientList: string
  contactList: string
  openDealList: string
  stageList: string
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

## Known contacts in this organization
${args.contactList ? `- ${args.contactList}` : "(none)"}

## Open deals (non-terminal, non-cancelled)
${args.openDealList ? `- ${args.openDealList}` : "(none)"}

## Funnel stages (resolved for this organization)
${args.stageList ? `- ${args.stageList}` : "(none)"}

# OUTPUT CONTRACT
Return JSON matching this exact shape (every field is required):

  {
    "relevant": boolean,
    "action": "CREATE" | "UPDATE_STAGE" | "SKIP",

    "newDealName":         "string",
    "newDealDescription":  "string",
    "newDealClientName":   "string",
    "newDealStageName":    "string",
    "newDealValue":        0,
    "newDealCurrency":     "EUR",
    "newDealContactNames": ["string"],

    "matchedDealName":     "string",
    "updatedStageName":    "string",
    "changes":             "string",

    "reasoning": "string"
  }

For UPDATE_STAGE: set "changes" to a 1–2 sentence description of what changed for the deal based on the new source signal (what drove the stage move). The deal's original description is NOT modified. Use "" for "changes" on CREATE / SKIP.
"reasoning" is always one sentence on why the deal is created or its funnel stage is changed.

Rules:
- If the source has nothing to do with deals, set relevant=false and action="SKIP".
  Use sentinel values for the rest: "" / 0 / [].
- If the signal matches an Open Deal in the list (by name or description),
  use action="UPDATE_STAGE":
    - matchedDealName: the deal's name from the Open Deals list above (exact match required)
    - updatedStageName: a Funnel Stage name (the NEW stage to move it to)
    - all CREATE-branch fields: sentinels.
- Otherwise use action="CREATE":
    - newDealClientName: must match a Known Client name exactly
    - newDealStageName: must match a Funnel Stage name exactly
    - newDealContactNames: only Known Contact names; [] if none apply
    - newDealValue: numeric amount stated in the source; 0 if not stated
    - newDealCurrency: 3-letter ISO; "" if not stated
    - all UPDATE_STAGE-branch fields: sentinels.
- Never invent clients, contacts, deals, or stages.
- Never return null, never omit a field.

# SOURCE ITEM
- Provider: ${args.provider}
- Title: ${args.title}
- Source created: ${args.sourceCreatedAt}

## Markdown
${args.markdown}
`
}
