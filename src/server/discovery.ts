"use server"

import { db } from "@/db/drizzle"
import { client, contact, sourceItem, type EntityStatus } from "@/db/schema"
import { and, eq, isNull, ne, or, sql, inArray, gte } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { normaliseCompanyName } from "@/lib/normalise-company-name"
import { isAutomatedEmail } from "@/lib/is-automated-email"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
  isFreemailDomain,
} from "@/lib/email-domain"
import { cleanPhone } from "@/server/parsers/_shared"
import { randomUUID } from "crypto"

// ── Types ────────────────────────────────────────────────────────────

/** A company candidate aggregated from `metadata_json.companies`. */
export type ClientCandidate = {
  /** First-seen original casing — used as the new client.name. */
  displayName: string
  /** Canonical dedup key — `normaliseCompanyName(displayName)`. */
  normalisedKey: string
  /** How many scanned source_items mention this company. */
  occurrences: number
  /** Same-run inferred website: set when a participant email's domain's
   *  second-level label normalises to this candidate's key. `null` when no
   *  contributing row carried a matching participant. Drives same-run
   *  link proposals (a fresh client has no DB `webUrl` yet). */
  inferredWebUrl: string | null
  /** Sample (capped at 5) source_item ids for context in the preview. */
  sampleSourceItemIds: string[]
  /** Set when this company's normalised key matches an existing client but
   *  the displayed name differs (e.g. existing "IN4COM" vs source "IN4COM
   *  GmbH") — points at that client so the dialog can flag a possible
   *  duplicate and pre-uncheck it. `null` when no such match (genuinely new)
   *  OR when the name is an exact match (silently merged, never surfaced).
   *  Checking it anyway creates a separate client (e.g. a different branch). */
  possibleDuplicate?: { clientId: string; name: string } | null
}

/** A contact candidate aggregated from row participants. */
export type ContactCandidate = {
  /** Longest non-empty name seen across the contributing rows (technical /
   *  envelope name — becomes contact.name). */
  displayName: string
  /** Lowercased + trimmed email — also the dedup key. */
  email: string
  /** Native-language name recovered from email bodies for this address
   *  (parser's `participantNativeNames`). `null` when none was found.
   *  Becomes contact.name_native. */
  nativeName: string | null
  /** How many scanned source_items mention this email. */
  occurrences: number
  /** Sample (capped at 5) source_item ids for context in the preview. */
  sampleSourceItemIds: string[]
  /** Set when this candidate's email is NOT yet a contact, but its name OR
   *  native name matches an existing contact AT THE SAME EMAIL DOMAIN —
   *  points at that contact so the dialog can flag a possible duplicate and
   *  pre-uncheck it. `null` when no such match. Advisory only: the operator
   *  still decides whether to create. (Email-equal matches are deduped out
   *  earlier and never become candidates.) */
  possibleDuplicate?: {
    contactId: string
    name: string
    email: string | null
  } | null
}

/** An email→native-name pairing collected across the scanned rows. */
export type NativeNameEntry = { email: string; nativeName: string }

/** An email→phone pairing collected across the scanned rows. */
export type PhoneEntry = { email: string; phone: string }

/** Stable reference to either an existing contact row or a new candidate. */
export type ContactRef =
  | { kind: "existing"; id: string }
  | { kind: "new"; email: string }

/** Stable reference to either an existing client row or a new candidate. */
export type ClientRef =
  | { kind: "existing"; id: string }
  | { kind: "new"; normalisedKey: string }

/** A proposed contact↔client link. Either side may be existing or new. */
export type LinkProposal = {
  contact: ContactRef
  client: ClientRef
  contactName: string
  contactEmail: string
  clientName: string
  /** The client domain the email domain matched on. */
  matchedDomain: string
  /** True when this contact matched 2+ clients; we pick the alphabetically
   *  first client name and flag so the UI can warn. */
  ambiguous: boolean
}

export type DiscoveryPeriod = "all" | "last_day" | "last_week" | "last_month"

export type DiscoveryPreview = {
  scannedRowCount: number
  /** Every source_item id inspected this run — stamped at apply time
   *  regardless of whether it contributed a candidate, so empty-yield rows
   *  aren't re-scanned forever. */
  scannedRowIds: string[]
  clientCandidates: ClientCandidate[]
  contactCandidates: ContactCandidate[]
  linkProposals: LinkProposal[]
  /** Every email→native-name pairing seen across the scanned rows
   *  (deduped, including emails that are ALREADY contacts). Applied to
   *  fill blank `contact.name_native` on apply — both new and existing. */
  nativeNames: NativeNameEntry[]
  /** Every email→phone pairing seen across the scanned rows (deduped,
   *  including already-contact emails). Applied to fill blank
   *  `contact.phone` on apply — both new and existing. */
  phones: PhoneEntry[]
}

export type ApplyDiscoveryInput = {
  selectedClientKeys: string[]
  selectedContactEmails: string[]
  /** Per-email display-name overrides (lets the operator rename before save). */
  contactNameOverrides: Record<string, string>
  selectedLinks: { contact: ContactRef; client: ClientRef }[]
  /** scannedRowIds from the preview — stamped on apply. */
  scannedRowIds: string[]
  /** Full candidate sets returned by previewDiscovery — needed at apply
   *  time for display names + inferred web URLs. */
  candidates: {
    clients: ClientCandidate[]
    contacts: ContactCandidate[]
  }
  /** Native-name pairings from the preview — applied to fill blank
   *  `contact.name_native` on both new and pre-existing contacts. */
  nativeNames: NativeNameEntry[]
  /** Phone pairings from the preview — applied to fill blank
   *  `contact.phone` on both new and pre-existing contacts. */
  phones: PhoneEntry[]
}

export type ApplyDiscoveryResult = {
  clientsCreated: number
  contactsCreated: number
  linksApplied: number
  scannedRowsStamped: number
  /** How many contacts had a blank `name_native` filled this run. */
  nativeNamesEnriched: number
  /** How many contacts had a blank `phone` filled this run. */
  phonesEnriched: number
  createdClients: { id: string; name: string }[]
  createdContacts: { id: string; name: string; email: string }[]
}

// ── Internal helpers (not exported — "use server" exports must be async) ──

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

/** Calendar-rough cutoff for the period selector. `all` → null (no filter). */
function periodCutoff(period: DiscoveryPeriod): Date | null {
  if (period === "all") return null
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const span =
    period === "last_day" ? day : period === "last_week" ? 7 * day : 30 * day
  return new Date(now - span)
}

type Participant = { email: string; name: string }

/**
 * Pull `{email, name}` participant pairs off a source_item's metadata.
 * Three shapes, tried in order (same email-keyed dedup across all):
 *   1. `metadata_json.participants: [{email, name}]` — canonical, written
 *      by gchat / gdrive sync (and any future provider that can expose
 *      emails). Nylas rows synced after this refactor also carry it.
 *   2. Nylas envelope `from / to / cc / bcc` arrays — fallback for old
 *      Nylas rows that pre-date the canonical field.
 *   3. `metadata_json.mentionedPeople: [{name, email, …}]` — LLM-extracted
 *      body mentions, written at parse time by every parser. Already
 *      filtered to high-confidence + non-empty email at write time
 *      (filterMentionedPeople), so we just feed them through the same dedup.
 * Automated addresses are dropped. Returns deduped-by-email (longest name
 * wins) pairs.
 */
function extractParticipants(meta: Record<string, unknown> | null): Participant[] {
  const m = meta ?? {}
  const byEmail = new Map<string, string>()

  const consider = (rawEmail: unknown, rawName: unknown) => {
    const email = (typeof rawEmail === "string" ? rawEmail : "").trim().toLowerCase()
    if (!email) return
    if (isAutomatedEmail(email)) return
    const name = (typeof rawName === "string" ? rawName : "").trim()
    const existing = byEmail.get(email)
    if (existing === undefined || name.length > existing.length) {
      byEmail.set(email, name)
    }
  }

  // 1. Canonical participants field.
  const canonical = m.participants
  if (Array.isArray(canonical)) {
    for (const p of canonical) {
      if (p && typeof p === "object") {
        consider((p as Record<string, unknown>).email, (p as Record<string, unknown>).name)
      }
    }
  }

  // 2. Nylas envelope fallback.
  for (const field of ["from", "to", "cc", "bcc"] as const) {
    const list = m[field]
    if (!Array.isArray(list)) continue
    for (const p of list) {
      if (p && typeof p === "object") {
        consider((p as Record<string, unknown>).email, (p as Record<string, unknown>).name)
      }
    }
  }

  // 3. LLM-extracted body mentions (parse-time). Already filtered to
  // high-confidence + non-empty email at parser write time, so we just run
  // them through the same dedup (consider() still drops automated addresses).
  const mentioned = m.mentionedPeople
  if (Array.isArray(mentioned)) {
    for (const p of mentioned) {
      if (p && typeof p === "object") {
        consider((p as Record<string, unknown>).email, (p as Record<string, unknown>).name)
      }
    }
  }

  return Array.from(byEmail.entries()).map(([email, name]) => ({ email, name }))
}

/**
 * Normalise a person name for fuzzy equality: trim, lowercase, collapse
 * whitespace. CJK-safe (lowercase is a no-op there). NOT for company names —
 * use `normaliseCompanyName`, which strips legal suffixes. Returns "" for the
 * "(unknown)" placeholder so it never matches.
 */
function normalisePersonName(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ")
  return s === "(unknown)" ? "" : s
}

/**
 * The label immediately before the TLD of a domain.
 *   "acme.com" → "acme" · "mail.acme.com" → "acme" · "acme" → ""
 * Used for same-run webUrl inference (does the email domain belong to a
 * company named like this candidate?).
 */
function secondLevelLabel(domain: string): string {
  const parts = domain.split(".").filter(Boolean)
  if (parts.length < 2) return ""
  return parts[parts.length - 2]
}

// ── previewDiscovery — single read-only scan ─────────────────────────

export async function previewDiscovery(opts?: {
  includeAlreadyScanned?: boolean
  period?: DiscoveryPeriod
}): Promise<DiscoveryPreview> {
  const { activeOrgId } = await requireOrgContext()
  const period = opts?.period ?? "all"
  const cutoff = periodCutoff(period)

  // ── 1. Eligible rows. Any provider — the per-provider gate is gone now
  //       that gchat/gdrive emit canonical participants. ───────────────
  const conditions = [
    eq(sourceItem.organizationId, activeOrgId),
    eq(sourceItem.parseStatus, "complete"),
  ]
  if (!opts?.includeAlreadyScanned) {
    conditions.push(
      or(
        isNull(sourceItem.discoveryScannedAt),
        sql`${sourceItem.parsedAt} > ${sourceItem.discoveryScannedAt}`,
      )!,
    )
  }
  if (cutoff) {
    conditions.push(gte(sourceItem.sourceCreatedAt, cutoff))
  }

  const rows = await db
    .select({
      id: sourceItem.id,
      metadataJson: sourceItem.metadataJson,
    })
    .from(sourceItem)
    .where(and(...conditions))

  const scannedRowIds = rows.map((r) => r.id)

  // ── Existing org entities for dedup ─────────────────────────────────
  const [existingClients, existingContacts] = await Promise.all([
    db
      .select({
        id: client.id,
        name: client.name,
        webUrl: client.webUrl,
        status: client.status,
      })
      .from(client)
      .where(eq(client.organizationId, activeOrgId)),
    db
      .select({
        id: contact.id,
        name: contact.name,
        nameNative: contact.nameNative,
        email: contact.email,
        clientId: contact.clientId,
        status: contact.status,
      })
      .from(contact)
      .where(eq(contact.organizationId, activeOrgId)),
  ])

  // normalised key → an existing client (first wins) for the possible-
  // duplicate flag, plus the set of exact (lowercased) existing names so we
  // can still silently merge truly-identical companies without a prompt.
  const existingClientByKey = new Map<string, { id: string; name: string }>()
  const exactExistingClientNames = new Set<string>()
  for (const c of existingClients) {
    // `deleted` clients are soft-deleted: skipped here so they neither block
    // re-discovery nor get flagged as a possible duplicate — a fresh re-scan
    // re-creates them (the test-iterate loop).
    if (c.status === "deleted") continue
    const key = normaliseCompanyName(c.name)
    if (key && !existingClientByKey.has(key)) {
      existingClientByKey.set(key, { id: c.id, name: c.name })
    }
    const lower = c.name.trim().toLowerCase()
    if (lower) exactExistingClientNames.add(lower)
  }
  const existingContactEmails = new Set(
    existingContacts
      // `deleted` contacts are soft-deleted: excluded from dedup so a re-scan
      // re-surfaces their email as a candidate.
      .filter((c) => c.status !== "deleted")
      .map((c) => (c.email ?? "").trim().toLowerCase())
      .filter((e) => e.length > 0),
  )

  // ── 2. Aggregate companies + 3. participants in a single pass ───────
  type ClientBucket = {
    displayName: string
    normalisedKey: string
    sourceItemIds: Set<string>
  }
  const clientBuckets = new Map<string, ClientBucket>()

  type ContactBucket = {
    email: string
    bestName: string
    sourceItemIds: Set<string>
  }
  const contactBuckets = new Map<string, ContactBucket>()

  // rowId → participant emails, kept for same-run webUrl inference.
  const participantsByRow = new Map<string, Participant[]>()

  // email → native-language name, accumulated across rows (longest wins).
  // Collected for ALL emails — including ones that are already contacts —
  // so apply can backfill blank `name_native` on existing contacts too.
  const nativeNameByEmail = new Map<string, string>()

  // email → phone number, accumulated across rows (first plausible wins).
  // Sourced from both the email parser's participantDetails (sender
  // signature) and mentionedPeople (any provider, third-party business
  // cards / contact blocks). Kept for ALL emails so apply can backfill
  // blank `contact.phone` on existing contacts too.
  const phoneByEmail = new Map<string, string>()
  const considerPhone = (rawEmail: unknown, rawPhone: unknown) => {
    const email = (typeof rawEmail === "string" ? rawEmail : "")
      .trim()
      .toLowerCase()
    const phone = cleanPhone(typeof rawPhone === "string" ? rawPhone : "")
    if (!email || !phone) return
    if (!phoneByEmail.has(email)) phoneByEmail.set(email, phone)
  }

  for (const row of rows) {
    const meta = (row.metadataJson as Record<string, unknown> | null) ?? {}

    // Companies
    const raw = meta.companies
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item !== "string") continue
        const name = item.trim()
        if (!name) continue
        const key = normaliseCompanyName(name)
        if (!key) continue
        // Drop only EXACT-name matches (truly the same client → silent merge,
        // as before). Suffix/format variants (e.g. existing "IN4COM" vs source
        // "IN4COM GmbH") share the key but differ in name → kept as a
        // candidate and flagged `possibleDuplicate` below so the operator
        // decides same-vs-new-branch.
        if (exactExistingClientNames.has(name.toLowerCase())) continue
        const existing = clientBuckets.get(key)
        if (existing) {
          existing.sourceItemIds.add(row.id)
        } else {
          clientBuckets.set(key, {
            displayName: name,
            normalisedKey: key,
            sourceItemIds: new Set([row.id]),
          })
        }
      }
    }

    // Participants
    const participants = extractParticipants(meta)
    participantsByRow.set(row.id, participants)
    for (const p of participants) {
      if (existingContactEmails.has(p.email)) continue
      const existing = contactBuckets.get(p.email)
      if (existing) {
        existing.sourceItemIds.add(row.id)
        if (p.name.length > existing.bestName.length) existing.bestName = p.name
      } else {
        contactBuckets.set(p.email, {
          email: p.email,
          bestName: p.name,
          sourceItemIds: new Set([row.id]),
        })
      }
    }

    // Envelope-participant details (email parser): native name + phone,
    // keyed by envelope email. Longest native name wins; first plausible
    // phone wins. Kept even for existing-contact emails (apply backfills).
    const detailsRaw = meta.participantDetails
    if (Array.isArray(detailsRaw)) {
      for (const n of detailsRaw) {
        if (!n || typeof n !== "object") continue
        const rec = n as Record<string, unknown>
        const email = (typeof rec.email === "string" ? rec.email : "")
          .trim()
          .toLowerCase()
        if (!email) continue
        const nativeName = (
          typeof rec.nativeName === "string" ? rec.nativeName : ""
        ).trim()
        if (nativeName) {
          const existing = nativeNameByEmail.get(email)
          if (existing === undefined || nativeName.length > existing.length) {
            nativeNameByEmail.set(email, nativeName)
          }
        }
        considerPhone(email, rec.phone)
      }
    }

    // Phones from body-mentioned third parties (any provider) — these carry
    // their own email, so the phone attaches to the right contact.
    const mentionedRaw = meta.mentionedPeople
    if (Array.isArray(mentionedRaw)) {
      for (const m of mentionedRaw) {
        if (!m || typeof m !== "object") continue
        const rec = m as Record<string, unknown>
        considerPhone(rec.email, rec.phone)
      }
    }
  }

  // ── 4. Same-run webUrl inference for new client candidates ──────────
  const clientCandidates: ClientCandidate[] = Array.from(
    clientBuckets.values(),
  ).map((b) => {
    let inferredWebUrl: string | null = null
    for (const rowId of b.sourceItemIds) {
      const participants = participantsByRow.get(rowId) ?? []
      for (const p of participants) {
        const domain = extractEmailDomain(p.email)
        if (!domain || isFreemailDomain(domain)) continue
        const label = secondLevelLabel(domain)
        if (label && normaliseCompanyName(label) === b.normalisedKey) {
          inferredWebUrl = `https://${domain}`
          break
        }
      }
      if (inferredWebUrl) break
    }
    return {
      displayName: b.displayName,
      normalisedKey: b.normalisedKey,
      occurrences: b.sourceItemIds.size,
      inferredWebUrl,
      sampleSourceItemIds: Array.from(b.sourceItemIds).slice(0, 5),
      // Key matches an existing client but the name differs (exact matches
      // were dropped above) → flag the existing client for the operator.
      possibleDuplicate: (() => {
        const m = existingClientByKey.get(b.normalisedKey)
        return m ? { clientId: m.id, name: m.name } : null
      })(),
    }
  })
  clientCandidates.sort(
    (a, b) =>
      b.occurrences - a.occurrences || a.displayName.localeCompare(b.displayName),
  )

  // Index existing contacts by email domain → their normalised names (both
  // technical + native), for the same-domain possible-duplicate guard. Only
  // contacts with an email domain and at least one usable name participate.
  const existingByDomain = new Map<
    string,
    { id: string; name: string; email: string | null; names: Set<string> }[]
  >()
  for (const c of existingContacts) {
    if (c.status === "deleted") continue
    const email = (c.email ?? "").trim().toLowerCase()
    const domain = email ? extractEmailDomain(email) : ""
    if (!domain) continue
    const names = new Set<string>()
    for (const n of [c.name, c.nameNative]) {
      const norm = normalisePersonName(n ?? "")
      if (norm.length >= 2) names.add(norm)
    }
    if (names.size === 0) continue
    const arr = existingByDomain.get(domain) ?? []
    arr.push({ id: c.id, name: c.name, email: c.email, names })
    existingByDomain.set(domain, arr)
  }

  const contactCandidates: ContactCandidate[] = Array.from(
    contactBuckets.values(),
  )
    .map((b) => {
      const nativeName = nativeNameByEmail.get(b.email) ?? null
      // Possible-duplicate check: candidate email is (by construction) not an
      // existing contact's email. Flag it when its technical OR native name
      // matches an existing contact's technical OR native name AND they share
      // an email domain — corroboration that avoids merging distinct people
      // who happen to share a common name.
      const candNames = new Set<string>()
      for (const n of [b.bestName, nativeName ?? ""]) {
        const norm = normalisePersonName(n)
        if (norm.length >= 2) candNames.add(norm)
      }
      const domain = extractEmailDomain(b.email)
      let possibleDuplicate: ContactCandidate["possibleDuplicate"] = null
      if (domain && candNames.size > 0) {
        for (const e of existingByDomain.get(domain) ?? []) {
          let overlap = false
          for (const nm of candNames) {
            if (e.names.has(nm)) {
              overlap = true
              break
            }
          }
          if (overlap) {
            possibleDuplicate = { contactId: e.id, name: e.name, email: e.email }
            break
          }
        }
      }
      return {
        displayName: b.bestName,
        email: b.email,
        nativeName,
        occurrences: b.sourceItemIds.size,
        sampleSourceItemIds: Array.from(b.sourceItemIds).slice(0, 5),
        possibleDuplicate,
      }
    })
    .sort(
      (a, b) =>
        b.occurrences - a.occurrences || a.email.localeCompare(b.email),
    )

  // All native-name pairings seen this run — keyed by email, including
  // emails that are already contacts (apply backfills those too).
  const nativeNames: NativeNameEntry[] = Array.from(
    nativeNameByEmail.entries(),
  ).map(([email, nativeName]) => ({ email, nativeName }))

  // All email→phone pairings seen this run (same posture: includes emails
  // that are already contacts, so apply can backfill blank phones).
  const phones: PhoneEntry[] = Array.from(phoneByEmail.entries()).map(
    ([email, phone]) => ({ email, phone }),
  )

  // ── 5. Build link proposals ─────────────────────────────────────────
  // Link side "clients": DB clients with a webUrl + new candidates with an
  // inferred one. Link side "contacts": DB unlinked contacts + new candidates.
  type LinkClient = { ref: ClientRef; name: string; domain: string }
  const linkClients: LinkClient[] = []
  for (const c of existingClients) {
    if (c.status === "suspended" || c.status === "deleted") continue
    const url = (c.webUrl ?? "").trim()
    if (!url) continue
    const domain = extractWebsiteDomain(url)
    if (!domain) continue
    linkClients.push({ ref: { kind: "existing", id: c.id }, name: c.name, domain })
  }
  for (const cand of clientCandidates) {
    if (!cand.inferredWebUrl) continue
    const domain = extractWebsiteDomain(cand.inferredWebUrl)
    if (!domain) continue
    linkClients.push({
      ref: { kind: "new", normalisedKey: cand.normalisedKey },
      name: cand.displayName,
      domain,
    })
  }

  type LinkContact = { ref: ContactRef; name: string; email: string }
  const linkContacts: LinkContact[] = []
  for (const c of existingContacts) {
    if (c.clientId) continue
    if (c.status === "suspended" || c.status === "deleted") continue
    const email = (c.email ?? "").trim()
    if (!email) continue
    linkContacts.push({ ref: { kind: "existing", id: c.id }, name: c.name, email })
  }
  for (const cand of contactCandidates) {
    linkContacts.push({
      ref: { kind: "new", email: cand.email },
      name: cand.displayName || cand.email,
      email: cand.email,
    })
  }

  const linkProposals: LinkProposal[] = []
  for (const lc of linkContacts) {
    const emailDomain = extractEmailDomain(lc.email)
    if (!emailDomain || isFreemailDomain(emailDomain)) continue
    const matches = linkClients.filter((cl) =>
      domainMatches(emailDomain, cl.domain),
    )
    if (matches.length === 0) continue
    matches.sort((a, b) => a.name.localeCompare(b.name))
    const picked = matches[0]
    linkProposals.push({
      contact: lc.ref,
      client: picked.ref,
      contactName: lc.name,
      contactEmail: lc.email,
      clientName: picked.name,
      matchedDomain: picked.domain,
      ambiguous: matches.length > 1,
    })
  }
  linkProposals.sort((a, b) => a.contactName.localeCompare(b.contactName))

  return {
    scannedRowCount: rows.length,
    scannedRowIds,
    clientCandidates,
    contactCandidates,
    linkProposals,
    nativeNames,
    phones,
  }
}

// ── applyDiscovery — sequential apply (Neon HTTP has no transactions) ──

export async function applyDiscovery(
  input: ApplyDiscoveryInput,
): Promise<ApplyDiscoveryResult> {
  const { session, activeOrgId } = await requireOrgContext()

  // ── 1. Insert clients ───────────────────────────────────────────────
  // Re-check existing keys first (parallel-session safety). `deleted` clients
  // are excluded — same as the preview-side dedup — so a key that only
  // collides with a soft-deleted client doesn't block the re-create.
  const existingClients = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(
      and(eq(client.organizationId, activeOrgId), ne(client.status, "deleted")),
    )
  const existingClientKeys = new Set(
    existingClients
      .map((c) => normaliseCompanyName(c.name))
      .filter((k) => k.length > 0),
  )

  const selectedClientKeys = new Set(input.selectedClientKeys)
  const toCreateClients = input.candidates.clients.filter((c) => {
    if (!selectedClientKeys.has(c.normalisedKey)) return false
    // Operator-confirmed branch: the candidate was flagged as a possible
    // duplicate of an existing client but explicitly selected → create a
    // separate client even though the normalised key collides (e.g. a
    // different country branch). Otherwise block on key collision to avoid
    // accidental dups / parallel-session races.
    if (c.possibleDuplicate) return true
    return !existingClientKeys.has(c.normalisedKey)
  })

  const createdClients: { id: string; name: string }[] = []
  // normalisedKey → new client id (for same-run link resolution).
  const newClientKeyToId = new Map<string, string>()
  if (toCreateClients.length > 0) {
    const now = new Date()
    const rows = toCreateClients.map((c) => ({
      id: randomUUID(),
      name: c.displayName,
      phone: null,
      email: null,
      address: null,
      webUrl: c.inferredWebUrl || null,
      funnelPhase: "awareness" as const,
      status: "initial" as const,
      userId: session.user.id,
      organizationId: activeOrgId,
      createdAt: now,
      updatedAt: now,
    }))
    await db.insert(client).values(rows)
    for (const r of rows) {
      createdClients.push({ id: r.id, name: r.name })
      const cand = toCreateClients.find((c) => c.displayName === r.name)
      if (cand) newClientKeyToId.set(cand.normalisedKey, r.id)
    }
  }

  // ── 2. Insert contacts ──────────────────────────────────────────────
  // `deleted` contacts excluded — see the client recheck above.
  const existingContacts = await db
    .select({ email: contact.email })
    .from(contact)
    .where(
      and(eq(contact.organizationId, activeOrgId), ne(contact.status, "deleted")),
    )
  const existingContactEmails = new Set(
    existingContacts
      .map((c) => (c.email ?? "").trim().toLowerCase())
      .filter((e) => e.length > 0),
  )

  const selectedContactEmails = new Set(
    input.selectedContactEmails.map((e) => e.trim().toLowerCase()).filter(Boolean),
  )
  const overrides = input.contactNameOverrides ?? {}
  // email → native-language name for this apply (lowercased keys).
  const nativeByEmail = new Map<string, string>()
  for (const n of input.nativeNames ?? []) {
    const email = (n.email ?? "").trim().toLowerCase()
    const nativeName = (n.nativeName ?? "").trim()
    if (email && nativeName) nativeByEmail.set(email, nativeName)
  }
  // email → phone for this apply (lowercased keys).
  const phoneMapByEmail = new Map<string, string>()
  for (const p of input.phones ?? []) {
    const email = (p.email ?? "").trim().toLowerCase()
    const phone = (p.phone ?? "").trim()
    if (email && phone) phoneMapByEmail.set(email, phone)
  }
  const toCreateContacts = input.candidates.contacts.filter(
    (c) =>
      selectedContactEmails.has(c.email) && !existingContactEmails.has(c.email),
  )

  const createdContacts: { id: string; name: string; email: string }[] = []
  // email → new contact id (for same-run link resolution).
  const newContactEmailToId = new Map<string, string>()
  if (toCreateContacts.length > 0) {
    const now = new Date()
    const rows = toCreateContacts.map((c) => {
      const overridden = (overrides[c.email] ?? "").trim()
      const fallback = c.displayName.trim() || "(unknown)"
      return {
        id: randomUUID(),
        name: overridden || fallback,
        nameNative: nativeByEmail.get(c.email) ?? null,
        email: c.email,
        phone: phoneMapByEmail.get(c.email) ?? null,
        position: null,
        clientId: null,
        status: "initial" as EntityStatus,
        userId: session.user.id,
        organizationId: activeOrgId,
        createdAt: now,
        updatedAt: now,
      }
    })
    await db.insert(contact).values(rows)
    for (const r of rows) {
      createdContacts.push({ id: r.id, name: r.name, email: r.email ?? "" })
      newContactEmailToId.set(r.email ?? "", r.id)
    }
  }

  // ── 3. Apply links ──────────────────────────────────────────────────
  // Resolve each ref pair to concrete ids via the maps populated above (or
  // the existing id). Drop unresolvable refs (entity wasn't selected for
  // creation) and refs to already-linked contacts (re-checked below).
  const resolveContact = (ref: ContactRef): string | null =>
    ref.kind === "existing" ? ref.id : newContactEmailToId.get(ref.email) ?? null
  const resolveClient = (ref: ClientRef): string | null =>
    ref.kind === "existing" ? ref.id : newClientKeyToId.get(ref.normalisedKey) ?? null

  const resolvedLinks: { contactId: string; clientId: string }[] = []
  for (const link of input.selectedLinks) {
    const contactId = resolveContact(link.contact)
    const clientId = resolveClient(link.client)
    if (!contactId || !clientId) continue
    resolvedLinks.push({ contactId, clientId })
  }

  let linksApplied = 0
  if (resolvedLinks.length > 0) {
    const contactIds = Array.from(new Set(resolvedLinks.map((l) => l.contactId)))
    const clientIds = Array.from(new Set(resolvedLinks.map((l) => l.clientId)))

    // Re-validate: contacts must be in-org AND currently unlinked; clients
    // must be in-org. Anything else is silently dropped.
    const [validContacts, validClients] = await Promise.all([
      db
        .select({ id: contact.id, clientId: contact.clientId })
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, activeOrgId),
            ne(contact.status, "deleted"),
            inArray(contact.id, contactIds),
          ),
        ),
      db
        .select({ id: client.id })
        .from(client)
        .where(
          and(
            eq(client.organizationId, activeOrgId),
            inArray(client.id, clientIds),
          ),
        ),
    ])
    const unlinkedContactIds = new Set(
      validContacts.filter((c) => c.clientId === null).map((c) => c.id),
    )
    const validClientIds = new Set(validClients.map((c) => c.id))

    for (const { contactId, clientId } of resolvedLinks) {
      if (!unlinkedContactIds.has(contactId)) continue
      if (!validClientIds.has(clientId)) continue
      await db.update(contact).set({ clientId }).where(eq(contact.id, contactId))
      // Guard against two links targeting the same just-linked contact in
      // one apply (last-write-wins otherwise).
      unlinkedContactIds.delete(contactId)
      linksApplied++
    }
  }

  // ── 4. Backfill native names onto existing contacts (fill blanks only) ─
  // New contacts already got their name_native at insert. This pass fills
  // pre-existing contacts whose name_native is still blank — never
  // overwrites a human-edited value. One UPDATE per email (rare: usually
  // just the sender).
  let nativeNamesEnriched = 0
  for (const [email, nativeName] of nativeByEmail) {
    const updated = await db
      .update(contact)
      .set({ nameNative: nativeName })
      .where(
        and(
          eq(contact.organizationId, activeOrgId),
          ne(contact.status, "deleted"),
          sql`lower(${contact.email}) = ${email}`,
          sql`(${contact.nameNative} IS NULL OR ${contact.nameNative} = '')`,
        ),
      )
      .returning({ id: contact.id })
    nativeNamesEnriched += updated.length
  }

  // Same fill-blanks-only pass for phone numbers.
  let phonesEnriched = 0
  for (const [email, phone] of phoneMapByEmail) {
    const updated = await db
      .update(contact)
      .set({ phone })
      .where(
        and(
          eq(contact.organizationId, activeOrgId),
          ne(contact.status, "deleted"),
          sql`lower(${contact.email}) = ${email}`,
          sql`(${contact.phone} IS NULL OR ${contact.phone} = '')`,
        ),
      )
      .returning({ id: contact.id })
    phonesEnriched += updated.length
  }

  // ── 5. Stamp every scanned row ──────────────────────────────────────
  let scannedRowsStamped = 0
  if (input.scannedRowIds.length > 0) {
    await db
      .update(sourceItem)
      .set({ discoveryScannedAt: new Date() })
      .where(
        and(
          eq(sourceItem.organizationId, activeOrgId),
          inArray(sourceItem.id, input.scannedRowIds),
        ),
      )
    scannedRowsStamped = input.scannedRowIds.length
  }

  return {
    clientsCreated: createdClients.length,
    contactsCreated: createdContacts.length,
    linksApplied,
    scannedRowsStamped,
    nativeNamesEnriched,
    phonesEnriched,
    createdClients,
    createdContacts,
  }
}
