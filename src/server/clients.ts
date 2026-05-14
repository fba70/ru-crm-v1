"use server"

import { db } from "@/db/drizzle"
import {
  client,
  contact,
  sourceItem,
  user,
  type FunnelPhase,
  type EntityStatus,
} from "@/db/schema"
import { and, eq, desc, isNull, or, sql, inArray } from "drizzle-orm"
import { generateText, Output, stepCountIs } from "ai"
import { google } from "@ai-sdk/google"
import { z } from "zod"
import { getServerSession } from "@/lib/get-session"
import { normaliseCompanyName } from "@/lib/normalise-company-name"
import { randomUUID } from "crypto"

export type ClientContactPreview = {
  id: string
  name: string
  email: string | null
  phone: string | null
  position: string | null
  status: EntityStatus
}

export type ClientRow = {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  webUrl: string | null
  funnelPhase: FunnelPhase
  status: EntityStatus
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
            eq(contact.status, "active"),
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
    phone: r.client.phone,
    email: r.client.email,
    address: r.client.address,
    webUrl: r.client.webUrl,
    funnelPhase: r.client.funnelPhase,
    status: r.client.status,
    userId: r.client.userId,
    userName: r.userName,
    organizationId: r.client.organizationId,
    createdAt: r.client.createdAt.toISOString(),
    updatedAt: r.client.updatedAt.toISOString(),
    contacts: contactsByClient.get(r.client.id) ?? [],
  }))
}

export async function createClient(data: {
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  webUrl?: string | null
  funnelPhase?: FunnelPhase
  status?: EntityStatus
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.name?.trim()) throw new Error("Name is required")

  const id = randomUUID()
  const now = new Date()
  await db.insert(client).values({
    id,
    name: data.name.trim(),
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    address: data.address?.trim() || null,
    webUrl: data.webUrl?.trim() || null,
    funnelPhase: data.funnelPhase ?? "awareness",
    status: data.status ?? "active",
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
    phone?: string | null
    email?: string | null
    address?: string | null
    webUrl?: string | null
    funnelPhase?: FunnelPhase
    status?: EntityStatus
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
      ...(data.funnelPhase !== undefined
        ? { funnelPhase: data.funnelPhase }
        : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    })
    .where(eq(client.id, clientId))
}

// ── Client discovery from source_item.metadata_json.companies ────────

export type DiscoveredCompany = {
  /** First-seen original casing — used as the new client.name. */
  displayName: string
  /** Canonical key used for dedup — `normaliseCompanyName(displayName)`. */
  normalisedKey: string
  /** How many source_items contain this company in metadata_json.companies. */
  occurrences: number
  /** Sample source_item ids where this company appears (capped at 5). */
  sampleSourceItemIds: string[]
  /** All source_item ids where this company appears — needed at apply
   *  time so we know which rows to stamp `client_discovery_scanned_at`. */
  sourceItemIds: string[]
}

export type DiscoveryPreview = {
  scannedRowCount: number
  candidates: DiscoveredCompany[]
}

/**
 * Scan unscanned (or re-parsed-since-last-scan) source_items in the active
 * org, extract the union of company names from metadata_json.companies,
 * dedup against existing client.name (using the same normalisation), and
 * return the candidate set with occurrence counts. NOT a write operation.
 */
export async function discoverClients(): Promise<DiscoveryPreview> {
  const { activeOrgId } = await requireOrgContext()

  // Source rows we haven't scanned yet, OR that have been re-parsed since
  // their last discovery scan. parse_status='complete' filter is a guard
  // against half-parsed rows whose metadata_json.companies might be stale.
  const rows = await db
    .select({
      id: sourceItem.id,
      metadataJson: sourceItem.metadataJson,
    })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.organizationId, activeOrgId),
        eq(sourceItem.parseStatus, "complete"),
        or(
          isNull(sourceItem.clientDiscoveryScannedAt),
          sql`${sourceItem.parsedAt} > ${sourceItem.clientDiscoveryScannedAt}`,
        ),
      ),
    )

  // Existing clients in the org — used to filter out already-known
  // companies. Match by normalised name.
  const existingClients = await db
    .select({ name: client.name })
    .from(client)
    .where(eq(client.organizationId, activeOrgId))
  const existingKeys = new Set(
    existingClients
      .map((c) => normaliseCompanyName(c.name))
      .filter((k) => k.length > 0),
  )

  // Aggregate companies across the scanned rows.
  type Bucket = {
    displayName: string
    normalisedKey: string
    sourceItemIds: Set<string>
  }
  const buckets = new Map<string, Bucket>()

  for (const row of rows) {
    const meta = (row.metadataJson as Record<string, unknown> | null) ?? {}
    const raw = meta.companies
    if (!Array.isArray(raw)) continue
    for (const item of raw) {
      if (typeof item !== "string") continue
      const name = item.trim()
      if (!name) continue
      const key = normaliseCompanyName(name)
      if (!key || existingKeys.has(key)) continue
      const existing = buckets.get(key)
      if (existing) {
        existing.sourceItemIds.add(row.id)
      } else {
        buckets.set(key, {
          // First-seen original casing wins as the display name.
          displayName: name,
          normalisedKey: key,
          sourceItemIds: new Set([row.id]),
        })
      }
    }
  }

  const candidates: DiscoveredCompany[] = Array.from(buckets.values())
    .map((b) => ({
      displayName: b.displayName,
      normalisedKey: b.normalisedKey,
      occurrences: b.sourceItemIds.size,
      sampleSourceItemIds: Array.from(b.sourceItemIds).slice(0, 5),
      sourceItemIds: Array.from(b.sourceItemIds),
    }))
    .sort((a, b) =>
      b.occurrences - a.occurrences ||
      a.displayName.localeCompare(b.displayName),
    )

  return { scannedRowCount: rows.length, candidates }
}

export type ApplyDiscoveryInput = {
  /** Subset of normalised keys the user picked to create as new clients. */
  selectedKeys: string[]
  /** Full candidate set returned by discoverClients() — needed so we know
   *  the displayName to use AND which source_item rows to stamp. */
  candidates: DiscoveredCompany[]
}

export type ApplyDiscoveryResult = {
  createdCount: number
  createdClients: { id: string; name: string }[]
  scannedRowsStamped: number
}

/**
 * Apply a user-edited discovery preview: insert the selected companies
 * as new clients (status='initial', funnelPhase='awareness'), then stamp
 * client_discovery_scanned_at = now() on every source_item row that
 * contributed to the preview (whether or not its company was selected).
 *
 * Re-running discovery skips those rows. Companies the user unchecked
 * therefore won't reappear unless they show up in a NEW source_item.
 */
export async function applyDiscoveredClients(
  input: ApplyDiscoveryInput,
): Promise<ApplyDiscoveryResult> {
  const { session, activeOrgId } = await requireOrgContext()

  // Re-check vs current clients in case a parallel session created some.
  const existingClients = await db
    .select({ name: client.name })
    .from(client)
    .where(eq(client.organizationId, activeOrgId))
  const existingKeys = new Set(
    existingClients
      .map((c) => normaliseCompanyName(c.name))
      .filter((k) => k.length > 0),
  )

  const selectedSet = new Set(input.selectedKeys)
  const toCreate = input.candidates.filter(
    (c) => selectedSet.has(c.normalisedKey) && !existingKeys.has(c.normalisedKey),
  )

  const createdClients: { id: string; name: string }[] = []
  if (toCreate.length > 0) {
    const now = new Date()
    const rows = toCreate.map((c) => ({
      id: randomUUID(),
      name: c.displayName,
      phone: null,
      email: null,
      address: null,
      webUrl: null,
      funnelPhase: "awareness" as const,
      status: "initial" as const,
      userId: session.user.id,
      organizationId: activeOrgId,
      createdAt: now,
      updatedAt: now,
    }))
    await db.insert(client).values(rows)
    for (const r of rows) createdClients.push({ id: r.id, name: r.name })
  }

  // Stamp every source_item that contributed to the preview — including
  // rows whose company the user rejected. They're considered "reviewed"
  // so the next discovery run only inspects new / re-parsed rows.
  const allScannedIds = Array.from(
    new Set(input.candidates.flatMap((c) => c.sourceItemIds)),
  )
  let scannedRowsStamped = 0
  if (allScannedIds.length > 0) {
    await db
      .update(sourceItem)
      .set({ clientDiscoveryScannedAt: new Date() })
      .where(
        and(
          eq(sourceItem.organizationId, activeOrgId),
          inArray(sourceItem.id, allScannedIds),
        ),
      )
    scannedRowsStamped = allScannedIds.length
  }

  return {
    createdCount: createdClients.length,
    createdClients,
    scannedRowsStamped,
  }
}

// ── Web lookup (Gemini + grounded google_search) ─────────────────────

const LOOKUP_RESEARCH_MODEL = "google/gemini-2.5-flash"
const LOOKUP_EXTRACT_MODEL = "google/gemini-2.5-flash"

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
            "Primary main-office phone in international format (e.g. '+43 1 234 5678'). Empty string if not found.",
          ),
        address: z
          .string()
          .describe(
            "Main / headquarters office street address as a single line: 'street, city, postcode, country'. Empty string if not found.",
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
 */
export async function lookupClientOnWeb(
  clientId: string,
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

  const knownLines = [
    `Name: ${target.name}`,
    target.email ? `Email: ${target.email}` : null,
    target.phone ? `Phone: ${target.phone}` : null,
    target.address ? `Address: ${target.address}` : null,
    target.webUrl ? `Website: ${target.webUrl}` : null,
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

  // ── Pass 1: grounded research ───────────────────────────────────────
  const researchPrompt = `I have the following CRM record for a company:

${knownLines}

Use web search to research this company. Identify the most likely real-world organisation (or organisations, if the name is ambiguous). For each candidate, gather: official company name, primary contact email, main-office phone, headquarters address, official website URL.

Write 2–4 short paragraphs of research notes summarising what you found. If multiple companies share this name, note them separately. Do NOT fabricate facts — only state what your search results actually confirm.`

  const research = await generateText({
    model: LOOKUP_RESEARCH_MODEL,
    system:
      "You are a precise company-research assistant. Use the google_search tool to find authoritative information about the given company. Prefer official websites, LinkedIn company pages, and corporate registries over social media or aggregators. Never invent details — if a field can't be confirmed by the search results, say so explicitly.",
    prompt: researchPrompt,
    tools: { google_search: google.tools.googleSearch({}) },
    // Bound the search → fetch → answer loop so the model can't spiral.
    stopWhen: stepCountIs(5),
  })

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
  const extractPrompt = `CRM record (current fields):
${knownLines}

Research notes from web search:
${research.text || "(no research output)"}

Based on the research notes, extract up to 3 candidate companies that could be the right match for this CRM record. Sort by confidence (best first). For each candidate, fill every field that the research notes confirm, and use empty strings for fields the research didn't establish. Use the candidates' likely match against the input record's address / contact email when rating confidence.`

  const { output: extracted } = await generateText({
    model: LOOKUP_EXTRACT_MODEL,
    output: Output.object({ schema: lookupExtractSchema }),
    system:
      "You convert research notes about companies into structured candidate records. Never invent fields — if the research notes don't confirm a value, return an empty string for that field. Use empty arrays for the candidates list if no plausible match was found.",
    prompt: extractPrompt,
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
