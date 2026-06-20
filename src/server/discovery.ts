"use server"

import { db } from "@/db/drizzle"
import { client, contact, sourceItem, type EntityStatus } from "@/db/schema"
import { and, eq, isNull, ne, or, sql, inArray, gte } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { companyMatchKey, personMatchKey } from "@/lib/translit-ru"
import { isAutomatedEmail } from "@/lib/is-automated-email"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
  isFreemailDomain,
} from "@/lib/email-domain"
import { loadOwnOrgIdentity } from "@/server/org-identity"
import { loadOrgBlocklist } from "@/server/blocklist"
import { cleanPhone } from "@/server/parsers/_shared"
import { randomUUID } from "crypto"

// ── Types ────────────────────────────────────────────────────────────

/** Self-rated confidence for a candidate / link, used to gate the review UI:
 *  `high` + `medium` are pre-checked, `low` is pre-unchecked (operator opts
 *  in). Garbage-level signals are dropped before they ever become a
 *  candidate, so there's no "none" tier. */
export type DiscoveryConfidence = "high" | "medium" | "low"

/** A company candidate aggregated from `metadata_json.companies` +
 *  `metadata_json.organizations`. */
export type ClientCandidate = {
  /** Best (fullest) original casing — used as the new client.name. */
  displayName: string
  /** Cross-script canonical dedup key — `companyMatchKey(displayName)`.
   *  Collapses Cyrillic/Latin + legal-form variants (АСТ ≡ AST ≡ ООО АСТ). */
  normalisedKey: string
  /** Other spellings of this company seen across the scanned rows (and from
   *  the parser's `organizations[].aliases`), excluding the displayName.
   *  Stored on the created client + used for future dedup. */
  aliases: string[]
  /** How confident discovery is that this is a real, correctly-named new
   *  client. Drives the review UI's default check state. */
  confidence: DiscoveryConfidence
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
  /** How confident discovery is that this is a real new contact. Drives the
   *  review UI's default check state. */
  confidence: DiscoveryConfidence
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

/** A blank-fill enrichment for an EXISTING client matched by company key
 *  (cross-script). Carries a discovered website + extra spellings so apply
 *  can fill a blank `webUrl` and union `aliases` onto a client that already
 *  exists (and was therefore never offered as a candidate). */
export type ClientEnrichmentEntry = {
  /** companyMatchKey of the matched existing client. */
  normalisedKey: string
  /** Discovered website (parser-attributed or label-matched), or null. */
  webUrl: string | null
  /** Spellings seen for this company — unioned into the client's aliases. */
  aliases: string[]
}

/** An email→native-name pairing collected across the scanned rows. */
export type NativeNameEntry = { email: string; nativeName: string }

/** An email→phone pairing collected across the scanned rows. */
export type PhoneEntry = { email: string; phone: string }

/** An email→position (job title) pairing collected across the scanned rows. */
export type PositionEntry = { email: string; position: string }

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
  /** How the contact was attributed to the client:
   *  - `domain`  — the contact's email domain matched the client's website
   *    domain (strongest signal).
   *  - `company` — the source items the contact appears in attribute them to
   *    a company that matches this client (used when no web domain is known). */
  matchedVia: "domain" | "company"
  /** Human-readable basis for the match, shown in the UI (e.g. the matched
   *  domain, or "company «АСТ»"). */
  matchedLabel: string
  /** Confidence in the link, gating the review UI default-check state. */
  confidence: DiscoveryConfidence
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
  /** Blank-fill enrichments for existing clients (matched by company key but
   *  not surfaced as candidates because the name matched exactly). Applied
   *  unconditionally on apply — fill-blanks only, never overwrites. */
  clientEnrichments: ClientEnrichmentEntry[]
  /** Every email→native-name pairing seen across the scanned rows
   *  (deduped, including emails that are ALREADY contacts). Applied to
   *  fill blank `contact.name_native` on apply — both new and existing. */
  nativeNames: NativeNameEntry[]
  /** Every email→phone pairing seen across the scanned rows (deduped,
   *  including already-contact emails). Applied to fill blank
   *  `contact.phone` on apply — both new and existing. */
  phones: PhoneEntry[]
  /** Every email→position (job title) pairing seen across the scanned rows
   *  (deduped, including already-contact emails). Applied to fill blank
   *  `contact.position` on apply — both new and existing. */
  positions: PositionEntry[]
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
  /** Existing-client blank-fill enrichments from the preview. */
  clientEnrichments?: ClientEnrichmentEntry[]
  /** Native-name pairings from the preview — applied to fill blank
   *  `contact.name_native` on both new and pre-existing contacts. */
  nativeNames: NativeNameEntry[]
  /** Phone pairings from the preview — applied to fill blank
   *  `contact.phone` on both new and pre-existing contacts. */
  phones: PhoneEntry[]
  /** Position pairings from the preview — applied to fill blank
   *  `contact.position` on both new and pre-existing contacts. */
  positions: PositionEntry[]
}

export type ApplyDiscoveryResult = {
  clientsCreated: number
  /** Soft-`deleted` clients that a selected candidate matched and were
   *  re-activated in place (status → initial, blanks filled) rather than
   *  inserted as a duplicate. Drives the test-cycle workflow. */
  clientsRevived: number
  /** Existing clients that gained aliases / a webUrl from a same-company
   *  candidate that wasn't created as a separate client. */
  clientsEnriched: number
  contactsCreated: number
  /** Soft-`deleted` contacts that a selected candidate matched and were
   *  re-activated in place rather than inserted as a duplicate. */
  contactsRevived: number
  linksApplied: number
  scannedRowsStamped: number
  /** How many contacts had a blank `name_native` filled this run. */
  nativeNamesEnriched: number
  /** How many contacts had a blank `phone` filled this run. */
  phonesEnriched: number
  /** How many contacts had a blank `position` filled this run. */
  positionsEnriched: number
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

/** Stable string id for a ClientRef — used to dedup matched clients. */
function clientRefKey(ref: ClientRef): string {
  return ref.kind === "existing" ? `e:${ref.id}` : `n:${ref.normalisedKey}`
}

// ── previewDiscovery — single read-only scan ─────────────────────────

export async function previewDiscovery(opts?: {
  includeAlreadyScanned?: boolean
  period?: DiscoveryPeriod
}): Promise<DiscoveryPreview> {
  const { activeOrgId } = await requireOrgContext()
  const period = opts?.period ?? "all"
  const cutoff = periodCutoff(period)
  const ownOrg = await loadOwnOrgIdentity(activeOrgId)
  // Blocklist guard — consulted at the SAME candidate drop-sites as the own-org
  // guard so business-irrelevant entities never surface. Re-aggregated each
  // preview, so adding an entry retroactively suppresses already-parsed items
  // on the next run (no re-parse needed). See refs/blocklist.md.
  const blocklist = await loadOrgBlocklist(activeOrgId)

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
        aliases: client.aliases,
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
        aliases: contact.aliases,
        email: contact.email,
        clientId: contact.clientId,
        status: contact.status,
      })
      .from(contact)
      .where(eq(contact.organizationId, activeOrgId)),
  ])

  // Cross-script match key → an existing client (first wins) for the
  // possible-duplicate flag, plus the set of exact (lowercased) existing
  // names/aliases so we can still silently merge truly-identical companies
  // without a prompt. Both the name AND every stored alias contribute keys,
  // so a candidate matching a known alias is recognised as the same client.
  const existingClientByKey = new Map<
    string,
    { id: string; name: string; webUrl: string | null }
  >()
  const exactExistingClientNames = new Set<string>()
  // `deleted` clients are NOT tombstones: a soft-deleted client is treated as
  // ABSENT here, so the company resurfaces as a candidate and `applyDiscovery`
  // REVIVES the soft-deleted row (reusing its id) instead of inserting a
  // duplicate. This is what makes the rules/parsing/attribution test cycle
  // work — delete an entity, re-scan, and it comes back through the new logic.
  // Steady-state production is unaffected: `discovery_scanned_at` already stops
  // scanned rows from re-surfacing unless they're re-parsed. Only active /
  // initial / suspended clients feed the dedup-and-possible-duplicate maps.
  for (const c of existingClients) {
    if (c.status === "deleted") continue
    const spellings = [c.name, ...(c.aliases ?? [])]
    for (const s of spellings) {
      const key = companyMatchKey(s)
      if (key && !existingClientByKey.has(key)) {
        existingClientByKey.set(key, { id: c.id, name: c.name, webUrl: c.webUrl })
      }
      const lower = (s ?? "").trim().toLowerCase()
      if (lower) exactExistingClientNames.add(lower)
    }
  }
  const existingContactEmails = new Set(
    existingContacts
      // Live contacts only. `deleted` contacts are NOT tombstones — their email
      // is treated as absent so the person resurfaces as a candidate and apply
      // REVIVES the soft-deleted row (mirrors the client side above).
      .filter((c) => c.status !== "deleted")
      .map((c) => (c.email ?? "").trim().toLowerCase())
      .filter((e) => e.length > 0),
  )

  // ── 2. Aggregate companies + 3. participants in a single pass ───────
  type ClientBucket = {
    displayName: string
    normalisedKey: string
    /** All distinct spellings seen (incl. the displayName), original casing. */
    spellings: Set<string>
    /** Websites the parser attributed to this company (organizations[].webUrl). */
    parserWebUrls: Set<string>
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

  // rowId → the set of company match-keys mentioned in that row (from both
  // `companies` and `organizations`). Used for contact↔client attribution.
  const rowCompanyKeys = new Map<string, Set<string>>()

  // company match-key → best display name seen (for company-link labels).
  const companyKeyToName = new Map<string, string>()

  // company match-key → blank-fill enrichment for an EXISTING client that
  // matched by key (so it's never a candidate). Accumulates a discovered
  // website + spellings to union into the client's aliases on apply.
  const enrichByKey = new Map<string, { webUrl: string | null; spellings: Set<string> }>()

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

  // email → position (job title), accumulated across rows (longest wins).
  // Sourced from the email parser's participantDetails (signature / contact
  // block). Kept for ALL emails so apply can backfill blank `contact.position`
  // on existing contacts too.
  const positionByEmail = new Map<string, string>()

  for (const row of rows) {
    const meta = (row.metadataJson as Record<string, unknown> | null) ?? {}

    // Companies — fold the flat `companies` list and the enriched
    // `organizations` list (name + aliases + webUrl) into one stream of
    // {spelling, key, webUrl?} signals, keyed cross-script so АСТ ≡ AST.
    const rowKeys = rowCompanyKeys.get(row.id) ?? new Set<string>()
    rowCompanyKeys.set(row.id, rowKeys)

    type CompanySignal = { spelling: string; aliases: string[]; webUrl: string }
    const companySignals: CompanySignal[] = []
    const rawCompanies = meta.companies
    if (Array.isArray(rawCompanies)) {
      for (const item of rawCompanies) {
        if (typeof item !== "string") continue
        const name = item.trim()
        if (name) companySignals.push({ spelling: name, aliases: [], webUrl: "" })
      }
    }
    const rawOrgs = meta.organizations
    if (Array.isArray(rawOrgs)) {
      for (const o of rawOrgs) {
        if (!o || typeof o !== "object") continue
        const rec = o as Record<string, unknown>
        const name = (typeof rec.name === "string" ? rec.name : "").trim()
        if (!name) continue
        const aliases = Array.isArray(rec.aliases)
          ? rec.aliases.filter((a): a is string => typeof a === "string").map((a) => a.trim()).filter(Boolean)
          : []
        const webUrl = (typeof rec.webUrl === "string" ? rec.webUrl : "").trim()
        companySignals.push({ spelling: name, aliases, webUrl })
      }
    }

    for (const sig of companySignals) {
      const key = companyMatchKey(sig.spelling)
      if (!key) continue
      // Skip the CRM owner's OWN company (it's the email recipient, not a
      // client). Excluding it here keeps it out of client candidates, out of
      // webUrl enrichment, AND out of `rowKeys` so contacts in the thread are
      // never attributed to the owner's own org. Soft-`deleted` clients are NOT
      // skipped — they resurface as candidates and are revived on apply.
      if (ownOrg.isOwnCompanyKey(key)) continue
      // Blocklisted company → never a candidate, never attributes contacts.
      if (blocklist.isBlockedCompanyKey(key)) continue
      rowKeys.add(key)
      if (!companyKeyToName.has(key)) companyKeyToName.set(key, sig.spelling)
      // Record the row company-key for every alias too (so an alias-only
      // mention in another row still attributes to the same client).
      for (const a of sig.aliases) {
        const ak = companyMatchKey(a)
        if (ak && !ownOrg.isOwnCompanyKey(ak) && !blocklist.isBlockedCompanyKey(ak)) {
          rowKeys.add(ak)
          if (!companyKeyToName.has(ak)) companyKeyToName.set(ak, a)
        }
      }
      // Silent-merge only EXACT-name matches against an existing client/alias
      // (truly the same client). Cross-script / legal-form variants share the
      // key but differ in spelling → kept as a candidate and flagged
      // `possibleDuplicate` below so the operator decides same-vs-new-branch.
      const isExactExisting =
        exactExistingClientNames.has(sig.spelling.toLowerCase()) ||
        sig.aliases.some((a) => exactExistingClientNames.has(a.toLowerCase()))
      // If this company matches an EXISTING client (by key), record a
      // blank-fill enrichment regardless of whether it's also a candidate —
      // so an existing client with no website can still gain one from a
      // freshly-discovered signal (parser webUrl or a label-matched domain).
      if (existingClientByKey.has(key)) {
        const e = enrichByKey.get(key) ?? { webUrl: null, spellings: new Set<string>() }
        e.spellings.add(sig.spelling)
        for (const a of sig.aliases) e.spellings.add(a)
        if (!e.webUrl && sig.webUrl && extractWebsiteDomain(sig.webUrl)) {
          e.webUrl = sig.webUrl
        }
        enrichByKey.set(key, e)
      }

      const bucket = clientBuckets.get(key)
      if (bucket) {
        bucket.sourceItemIds.add(row.id)
        bucket.spellings.add(sig.spelling)
        for (const a of sig.aliases) bucket.spellings.add(a)
        if (sig.webUrl) bucket.parserWebUrls.add(sig.webUrl)
      } else if (!isExactExisting) {
        clientBuckets.set(key, {
          displayName: sig.spelling,
          normalisedKey: key,
          spellings: new Set([sig.spelling, ...sig.aliases]),
          parserWebUrls: sig.webUrl ? new Set([sig.webUrl]) : new Set(),
          sourceItemIds: new Set([row.id]),
        })
      }
      // Note: when isExactExisting, we still recorded rowKeys above so the
      // company can attribute contacts to the existing client via linking.
    }

    // Participants. Drop any address on the CRM owner's OWN domain (e.g. the
    // mailbox the thread is addressed TO) so the owner never becomes a contact,
    // the owner's domain never feeds webUrl inference (it would otherwise be
    // the "sole business domain" and get stamped onto the external company),
    // and the owner's address never anchors a link.
    const participants = extractParticipants(meta).filter(
      (p) =>
        !ownOrg.isOwnDomain(extractEmailDomain(p.email)) &&
        // Blocked email (or any address under a blocked domain) → never a
        // contact candidate, never feeds webUrl inference, never anchors a link.
        !blocklist.isBlockedEmail(p.email),
    )
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
        const position = (
          typeof rec.position === "string" ? rec.position : ""
        ).trim()
        if (position) {
          const existing = positionByEmail.get(email)
          if (existing === undefined || position.length > existing.length) {
            positionByEmail.set(email, position)
          }
        }
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

  // ── 4. webUrl inference + confidence for new client candidates ──────
  // Resolution order (strongest → weakest), each carrying a confidence floor:
  //   1. Parser-attributed website (organizations[].webUrl)        → high
  //   2. A participant business domain whose label matches the name → high
  //   3. The ONLY business (non-freemail) domain across the rows    → medium
  // Step 3 is the relaxed inference that fixes the АСТ ↔ ast-inter.ru case:
  // the domain label ("ast-inter") doesn't string-match the name ("АСТ"), but
  // it's the sole business domain co-occurring with the company, so we adopt
  // it (and let the confidence + review UI catch the rare false positive).
  const clientCandidates: ClientCandidate[] = Array.from(
    clientBuckets.values(),
  ).map((b) => {
    // Collect the distinct non-freemail participant domains across this
    // candidate's rows.
    const businessDomains = new Set<string>()
    let labelMatchUrl: string | null = null
    for (const rowId of b.sourceItemIds) {
      for (const p of participantsByRow.get(rowId) ?? []) {
        const domain = extractEmailDomain(p.email)
        if (!domain || isFreemailDomain(domain)) continue
        businessDomains.add(domain)
        const label = secondLevelLabel(domain)
        if (!labelMatchUrl && label && companyMatchKey(label) === b.normalisedKey) {
          labelMatchUrl = `https://${domain}`
        }
      }
    }

    let inferredWebUrl: string | null = null
    let webUrlLevel: DiscoveryConfidence | null = null
    // 1. Parser-attributed website. Ignore one that resolves to the owner's
    // own domain (the parser sometimes attributes the recipient domain to the
    // company the email is about).
    for (const u of b.parserWebUrls) {
      const d = extractWebsiteDomain(u)
      if (d && !ownOrg.isOwnDomain(d) && !blocklist.isBlockedDomain(d)) {
        inferredWebUrl = u
        webUrlLevel = "high"
        break
      }
    }
    // 2. Label match.
    if (!inferredWebUrl && labelMatchUrl) {
      inferredWebUrl = labelMatchUrl
      webUrlLevel = "high"
    }
    // 3. Sole business domain.
    if (!inferredWebUrl && businessDomains.size === 1) {
      inferredWebUrl = `https://${Array.from(businessDomains)[0]}`
      webUrlLevel = "medium"
    }

    const occurrences = b.sourceItemIds.size
    const aliases = Array.from(b.spellings).filter(
      (s) => s.trim() && s !== b.displayName,
    )
    // Confidence: a determinable website OR repeated mention → high; a single
    // mention with weaker corroboration → medium; a lone, uncorroborated
    // single mention → low (pre-unchecked for review).
    const confidence: DiscoveryConfidence =
      webUrlLevel === "high" || occurrences >= 2
        ? "high"
        : inferredWebUrl || aliases.length > 0
          ? "medium"
          : "low"

    return {
      displayName: b.displayName,
      normalisedKey: b.normalisedKey,
      aliases,
      confidence,
      occurrences,
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
    // personMatchKey transliterates + token-sorts, so "Богданов Евгений",
    // "Евгений Богданов" and "Bogdanov Evgeniy" all collapse to one key —
    // catching cross-script + name-order duplicates, not just exact spellings.
    for (const n of [c.name, c.nameNative, ...(c.aliases ?? [])]) {
      const norm = personMatchKey(n ?? "")
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
        const norm = personMatchKey(n)
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
      // Confidence: a person at a real company domain, or one mentioned more
      // than once, is high; a single mention from a freemail address is
      // medium; a single freemail mention with no name is low.
      const occurrences = b.sourceItemIds.size
      const isBusiness = domain ? !isFreemailDomain(domain) : false
      const hasName = normalisePersonName(b.bestName).length >= 2
      const confidence: DiscoveryConfidence =
        isBusiness || occurrences >= 2
          ? "high"
          : hasName
            ? "medium"
            : "low"
      return {
        displayName: b.bestName,
        email: b.email,
        nativeName,
        confidence,
        occurrences,
        sampleSourceItemIds: Array.from(b.sourceItemIds).slice(0, 5),
        possibleDuplicate,
      }
    })
    .sort(
      (a, b) =>
        b.occurrences - a.occurrences || a.email.localeCompare(b.email),
    )

  // Existing-client enrichments: only emit when there's something to apply
  // (a discovered webUrl or extra spellings beyond what the client stores).
  const clientEnrichments: ClientEnrichmentEntry[] = Array.from(
    enrichByKey.entries(),
  )
    .map(([normalisedKey, e]) => ({
      normalisedKey,
      webUrl: e.webUrl,
      aliases: Array.from(e.spellings).filter((s) => s.trim()),
    }))
    .filter((e) => e.webUrl || e.aliases.length > 0)

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

  // All email→position pairings seen this run (same posture: includes
  // already-contact emails so apply can backfill blank positions).
  const positions: PositionEntry[] = Array.from(positionByEmail.entries()).map(
    ([email, position]) => ({ email, position }),
  )

  // ── 5. Build link proposals ─────────────────────────────────────────
  // Two attribution signals, domain-first (one proposal per contact):
  //   A. DOMAIN  — the contact's email domain matches a client's website
  //                domain. Strongest; works for both existing clients (with a
  //                webUrl) and new candidates (with an inferred webUrl).
  //   B. COMPANY — the source items the contact appears in attribute them to a
  //                company that matches a client. Used when no web domain is
  //                known (the common case — most clients have no webUrl). Only
  //                business-email contacts with a SINGLE, consistently-
  //                attributed company qualify, to avoid linking the other side
  //                of a thread (e.g. the vendor) to the discussed company.

  // Link-side clients indexed two ways: by website domain (A) and by company
  // match-key (B). Existing + new candidates both participate in BOTH indexes.
  type LinkClient = { ref: ClientRef; name: string }
  const clientByDomain: { client: LinkClient; domain: string }[] = []
  const clientByCompanyKey = new Map<string, LinkClient[]>()
  const addClientKey = (lc: LinkClient, key: string) => {
    if (!key) return
    const arr = clientByCompanyKey.get(key) ?? []
    arr.push(lc)
    clientByCompanyKey.set(key, arr)
  }
  for (const c of existingClients) {
    if (c.status === "suspended" || c.status === "deleted") continue
    const lc: LinkClient = { ref: { kind: "existing", id: c.id }, name: c.name }
    const url = (c.webUrl ?? "").trim()
    const domain = url ? extractWebsiteDomain(url) : ""
    // Skip a client whose stored website is actually the owner's own domain
    // (legacy bad data from before this guard) — it must not claim the owner's
    // domain for contact linking.
    if (domain && !ownOrg.isOwnDomain(domain) && !blocklist.isBlockedDomain(domain))
      clientByDomain.push({ client: lc, domain })
    for (const s of [c.name, ...(c.aliases ?? [])]) addClientKey(lc, companyMatchKey(s))
  }
  for (const cand of clientCandidates) {
    const lc: LinkClient = {
      ref: { kind: "new", normalisedKey: cand.normalisedKey },
      name: cand.displayName,
    }
    if (cand.inferredWebUrl) {
      const domain = extractWebsiteDomain(cand.inferredWebUrl)
      if (domain && !blocklist.isBlockedDomain(domain))
        clientByDomain.push({ client: lc, domain })
    }
    addClientKey(lc, cand.normalisedKey)
    for (const a of cand.aliases) addClientKey(lc, companyMatchKey(a))
  }

  // Link-side contacts: DB unlinked contacts + new candidates, with the set of
  // rows each appears in (for company attribution).
  type LinkContact = { ref: ContactRef; name: string; email: string; rows: Set<string> }
  const emailToRows = new Map<string, Set<string>>()
  for (const [rowId, participants] of participantsByRow) {
    for (const p of participants) {
      const set = emailToRows.get(p.email) ?? new Set<string>()
      set.add(rowId)
      emailToRows.set(p.email, set)
    }
  }
  const linkContacts: LinkContact[] = []
  for (const c of existingContacts) {
    if (c.clientId) continue
    if (c.status === "suspended" || c.status === "deleted") continue
    const email = (c.email ?? "").trim()
    if (!email) continue
    linkContacts.push({
      ref: { kind: "existing", id: c.id },
      name: c.name,
      email,
      rows: emailToRows.get(email.toLowerCase()) ?? new Set(),
    })
  }
  for (const cand of contactCandidates) {
    linkContacts.push({
      ref: { kind: "new", email: cand.email },
      name: cand.displayName || cand.email,
      email: cand.email,
      rows: emailToRows.get(cand.email) ?? new Set(),
    })
  }

  const linkProposals: LinkProposal[] = []
  for (const lc of linkContacts) {
    const emailDomain = extractEmailDomain(lc.email)
    const isFreemail = !emailDomain || isFreemailDomain(emailDomain)

    // A. Domain attribution (skip freemail — gmail can't identify a company).
    if (!isFreemail) {
      const matches = clientByDomain.filter((cl) =>
        domainMatches(emailDomain, cl.domain),
      )
      if (matches.length > 0) {
        matches.sort((a, b) => a.client.name.localeCompare(b.client.name))
        const picked = matches[0]
        linkProposals.push({
          contact: lc.ref,
          client: picked.client.ref,
          contactName: lc.name,
          contactEmail: lc.email,
          clientName: picked.client.name,
          matchedVia: "domain",
          matchedLabel: picked.domain,
          confidence: matches.length > 1 ? "medium" : "high",
          ambiguous: matches.length > 1,
        })
        continue // one proposal per contact; domain wins.
      }
    }

    // B. Company attribution — the contact's rows consistently attribute them
    // to exactly one matchable company. `rowCompanyKeys` already excludes the
    // owner's own company (step C), so the owner's domain/name can't be the
    // attributed company. Freemail contacts ARE allowed here (just at lower
    // confidence): a gmail address can't identify a company by its domain, but
    // if every company-bearing email they appear in points to one client, that
    // is a real signal the operator can confirm. This is what links an external
    // gmail sender (writing to the owner's mailbox about one company) to that
    // company even though both rule A and the old business-only B missed it.
    if (lc.rows.size === 0) continue
    const keyCounts = new Map<string, number>()
    // Denominator = rows that actually attribute a matchable company. A thread
    // row that mentions no (non-own) client company shouldn't count against
    // consistency — otherwise a single own-org-only email in the thread would
    // veto an otherwise-clear attribution.
    let attributingRowCount = 0
    for (const rowId of lc.rows) {
      const matchableKeys = Array.from(rowCompanyKeys.get(rowId) ?? []).filter(
        (k) => clientByCompanyKey.has(k),
      )
      if (matchableKeys.length === 0) continue
      attributingRowCount++
      for (const k of matchableKeys) {
        keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1)
      }
    }
    if (attributingRowCount === 0) continue
    // Keys attributed in ALL of the contact's attributing rows.
    const consistentKeys = Array.from(keyCounts.entries())
      .filter(([, n]) => n === attributingRowCount)
      .map(([k]) => k)
    if (consistentKeys.length === 0) continue
    // Gather distinct matched clients across the consistent keys.
    const matchedClients = new Map<string, LinkClient>()
    for (const k of consistentKeys) {
      for (const cl of clientByCompanyKey.get(k) ?? []) {
        matchedClients.set(clientRefKey(cl.ref), cl)
      }
    }
    const arr = Array.from(matchedClients.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    const picked = arr[0]
    const companyName =
      companyKeyToName.get(consistentKeys[0]) ?? picked.name
    // Ambiguous (>1 candidate client) or a freemail anchor → low (pre-unchecked,
    // operator opts in). A single match from a business email → medium.
    const confidence: DiscoveryConfidence =
      arr.length > 1 || isFreemail ? "low" : "medium"
    linkProposals.push({
      contact: lc.ref,
      client: picked.ref,
      contactName: lc.name,
      contactEmail: lc.email,
      clientName: picked.name,
      matchedVia: "company",
      matchedLabel: `company «${companyName}»`,
      confidence,
      ambiguous: arr.length > 1,
    })
  }
  linkProposals.sort((a, b) => a.contactName.localeCompare(b.contactName))

  return {
    scannedRowCount: rows.length,
    scannedRowIds,
    clientCandidates,
    contactCandidates,
    linkProposals,
    clientEnrichments,
    nativeNames,
    phones,
    positions,
  }
}

// ── applyDiscovery — sequential apply (Neon HTTP has no transactions) ──

export async function applyDiscovery(
  input: ApplyDiscoveryInput,
): Promise<ApplyDiscoveryResult> {
  const { session, activeOrgId } = await requireOrgContext()
  const ownOrg = await loadOwnOrgIdentity(activeOrgId)
  // Defense-in-depth against a stale preview: a block added between preview and
  // apply must still suppress the entity.
  const blocklist = await loadOrgBlocklist(activeOrgId)

  // ── 1. Insert clients ───────────────────────────────────────────────
  // Re-check existing keys first (parallel-session safety). `deleted` clients
  // are NOT tombstones — a soft-deleted client whose key matches a selected
  // candidate is REVIVED (status flipped back, blanks filled) instead of
  // inserted as a duplicate, reusing its id so deals / cards / contact links
  // that referenced it stay intact.
  const existingClients = await db
    .select({
      id: client.id,
      name: client.name,
      aliases: client.aliases,
      webUrl: client.webUrl,
      status: client.status,
    })
    .from(client)
    .where(eq(client.organizationId, activeOrgId))
  // key → existing LIVE client (cross-script, alias-aware). Used both to block
  // accidental dup creation and to backfill aliases / webUrl onto the match.
  const existingClientByKey = new Map<
    string,
    { id: string; webUrl: string | null; aliases: string[] }
  >()
  // key → a soft-deleted client to REVIVE if a selected candidate matches it.
  const deletedClientByKey = new Map<
    string,
    { id: string; webUrl: string | null; aliases: string[] }
  >()
  for (const c of existingClients) {
    const target = c.status === "deleted" ? deletedClientByKey : existingClientByKey
    for (const s of [c.name, ...(c.aliases ?? [])]) {
      const key = companyMatchKey(s)
      if (key && !target.has(key)) {
        target.set(key, { id: c.id, webUrl: c.webUrl, aliases: c.aliases ?? [] })
      }
    }
  }
  // A key owned by a LIVE client is never a revive target — the live client
  // wins (normal dedup / enrich applies).
  for (const k of existingClientByKey.keys()) deletedClientByKey.delete(k)
  const existingClientKeys = new Set(existingClientByKey.keys())

  const selectedClientKeys = new Set(input.selectedClientKeys)
  const toCreateClients = input.candidates.clients.filter((c) => {
    if (!selectedClientKeys.has(c.normalisedKey)) return false
    // Never create the owner's own company (defence in depth — the preview
    // already excludes it, but a stale / forged payload must not slip it past).
    if (ownOrg.isOwnCompanyKey(c.normalisedKey)) return false
    // Never create a blocklisted company (defence in depth).
    if (blocklist.isBlockedCompanyKey(c.normalisedKey)) return false
    // Operator-confirmed branch: the candidate was flagged as a possible
    // duplicate of an existing client but explicitly selected → create a
    // separate client even though the normalised key collides (e.g. a
    // different country branch). Otherwise block on key collision to avoid
    // accidental dups / parallel-session races. Keys matching a soft-deleted
    // client fall through here and are REVIVED (not inserted) in the split below.
    if (c.possibleDuplicate) return true
    return !existingClientKeys.has(c.normalisedKey)
  })

  const createdClients: { id: string; name: string }[] = []
  const revivedClients: { id: string; name: string }[] = []
  // normalisedKey → client id (new OR revived) for same-run link resolution.
  const newClientKeyToId = new Map<string, string>()

  // Split selected candidates: those whose key matches a soft-deleted client
  // are REVIVED (reuse the row); the rest are inserted fresh. A `possibleDuplicate`
  // candidate matched a LIVE client and was explicitly branched → always insert.
  const reviveClientCands = toCreateClients.filter(
    (c) => !c.possibleDuplicate && deletedClientByKey.has(c.normalisedKey),
  )
  const insertClientCands = toCreateClients.filter(
    (c) => c.possibleDuplicate || !deletedClientByKey.has(c.normalisedKey),
  )

  // Revive soft-deleted clients — one UPDATE each: restore status, refresh the
  // name, fill a blank webUrl, union aliases. Keeps the original id.
  for (const c of reviveClientCands) {
    const target = deletedClientByKey.get(c.normalisedKey)!
    const mergedAliases = Array.from(
      new Set(
        [...(target.aliases ?? []), ...c.aliases]
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    )
    await db
      .update(client)
      .set({
        name: c.displayName,
        status: "initial",
        // Fill-blanks: keep the row's existing website if it had one.
        webUrl: target.webUrl || c.inferredWebUrl || null,
        aliases: mergedAliases.length > 0 ? mergedAliases : null,
        updatedAt: new Date(),
      })
      .where(eq(client.id, target.id))
    revivedClients.push({ id: target.id, name: c.displayName })
    newClientKeyToId.set(c.normalisedKey, target.id)
  }

  if (insertClientCands.length > 0) {
    const now = new Date()
    const rows = insertClientCands.map((c) => ({
      id: randomUUID(),
      name: c.displayName,
      phone: null,
      email: null,
      address: null,
      webUrl: c.inferredWebUrl || null,
      // Record the alternate spellings discovery folded together so future
      // dedup / attribution recognises this company under any of them.
      aliases: c.aliases && c.aliases.length > 0 ? c.aliases : null,
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
      const cand = insertClientCands.find((c) => c.displayName === r.name)
      if (cand) newClientKeyToId.set(cand.normalisedKey, r.id)
    }
  }

  // ── 1b/1c. Enrich EXISTING clients (fill-blanks only, never overwrite) ──
  // Two sources feed this:
  //   1b. A candidate flagged `possibleDuplicate` and left unchecked — the
  //       same company under a different spelling (existing "АСТ" + source
  //       "AST"). Don't create a dup; fold the spelling into the client.
  //   1c. `clientEnrichments` — exact-name matches that were never offered as
  //       a candidate, carrying a freshly-discovered website / spellings.
  // Both union new spellings into `aliases` and fill a blank `webUrl`.
  let clientsEnriched = 0
  const createdKeys = new Set(toCreateClients.map((c) => c.normalisedKey))
  // Fill-blanks helper, idempotent across calls in one apply (mutates the
  // in-memory match so a second touch sees the new state; counts a client
  // at most once).
  const enrichedClientIds = new Set<string>()
  const enrichExistingClient = async (
    key: string,
    webUrl: string | null,
    spellings: string[],
  ) => {
    const match = existingClientByKey.get(key)
    if (!match) return
    const newAliases = spellings.map((s) => s.trim()).filter(Boolean)
    const merged = Array.from(new Set([...(match.aliases ?? []), ...newAliases]))
    const aliasesChanged = merged.length !== (match.aliases?.length ?? 0)
    const fillWebUrl = !match.webUrl && webUrl ? webUrl : null
    if (!aliasesChanged && !fillWebUrl) return
    await db
      .update(client)
      .set({
        ...(aliasesChanged ? { aliases: merged } : {}),
        ...(fillWebUrl ? { webUrl: fillWebUrl } : {}),
      })
      .where(eq(client.id, match.id))
    // Reflect the change locally so a later pass doesn't re-fill / miss it.
    match.aliases = merged
    if (fillWebUrl) match.webUrl = fillWebUrl
    if (!enrichedClientIds.has(match.id)) {
      enrichedClientIds.add(match.id)
      clientsEnriched++
    }
  }

  // 1b — candidates not created.
  for (const cand of input.candidates.clients) {
    if (createdKeys.has(cand.normalisedKey)) continue
    if (!existingClientByKey.has(cand.normalisedKey)) continue
    await enrichExistingClient(cand.normalisedKey, cand.inferredWebUrl, [
      cand.displayName,
      ...cand.aliases,
    ])
  }
  // 1c — exact-name existing clients carrying a discovered website / spellings.
  for (const e of input.clientEnrichments ?? []) {
    if (createdKeys.has(e.normalisedKey)) continue
    await enrichExistingClient(e.normalisedKey, e.webUrl, e.aliases)
  }

  // ── 2. Insert contacts ──────────────────────────────────────────────
  // Live-contact emails block creation. `deleted` contacts are NOT tombstones —
  // a soft-deleted contact whose email matches a selected candidate is REVIVED
  // (status flipped back, blanks filled, stale clientId cleared) instead of
  // inserted as a duplicate. Mirrors the preview-side `existingContactEmails`.
  const existingContacts = await db
    .select({ id: contact.id, email: contact.email, status: contact.status })
    .from(contact)
    .where(eq(contact.organizationId, activeOrgId))
  const existingContactEmails = new Set<string>()
  // email → a soft-deleted contact id to REVIVE if a candidate matches it.
  const deletedContactByEmail = new Map<string, string>()
  for (const c of existingContacts) {
    const email = (c.email ?? "").trim().toLowerCase()
    if (!email) continue
    if (c.status === "deleted") {
      if (!deletedContactByEmail.has(email)) deletedContactByEmail.set(email, c.id)
    } else {
      existingContactEmails.add(email)
    }
  }
  // An email owned by a LIVE contact is never a revive target.
  for (const e of existingContactEmails) deletedContactByEmail.delete(e)

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
  // email → position (job title) for this apply (lowercased keys).
  const positionMapByEmail = new Map<string, string>()
  for (const p of input.positions ?? []) {
    const email = (p.email ?? "").trim().toLowerCase()
    const position = (p.position ?? "").trim()
    if (email && position) positionMapByEmail.set(email, position)
  }
  const toCreateContacts = input.candidates.contacts.filter(
    (c) =>
      selectedContactEmails.has(c.email) &&
      !existingContactEmails.has(c.email) &&
      // Defence in depth: skip blocked emails / blocked-domain addresses.
      !blocklist.isBlockedEmail(c.email),
  )
  // Split: candidates whose email matches a soft-deleted contact are REVIVED
  // (reuse the row); the rest are inserted fresh.
  const reviveContactCands = toCreateContacts.filter((c) =>
    deletedContactByEmail.has(c.email),
  )
  const insertContactCands = toCreateContacts.filter(
    (c) => !deletedContactByEmail.has(c.email),
  )

  const createdContacts: { id: string; name: string; email: string }[] = []
  const revivedContacts: { id: string; name: string; email: string }[] = []
  // email → contact id (new OR revived) for same-run link resolution.
  const newContactEmailToId = new Map<string, string>()

  // Revive soft-deleted contacts — restore status, refresh the name, and clear
  // the stale clientId so the link step re-establishes attribution. Native
  // name / phone / position are left to the fill-blanks backfill passes below
  // (which now match the revived `initial` row), so any operator-entered values
  // on the old row are preserved. Keeps the original id.
  for (const c of reviveContactCands) {
    const id = deletedContactByEmail.get(c.email)!
    const overridden = (overrides[c.email] ?? "").trim()
    const newName = overridden || c.displayName.trim()
    await db
      .update(contact)
      .set({
        // Only overwrite the name when we have a usable one — otherwise keep
        // whatever the soft-deleted row carried (name is NOT NULL).
        ...(newName ? { name: newName } : {}),
        clientId: null,
        status: "initial",
        updatedAt: new Date(),
      })
      .where(eq(contact.id, id))
    revivedContacts.push({ id, name: newName || c.email, email: c.email })
    newContactEmailToId.set(c.email, id)
  }

  if (insertContactCands.length > 0) {
    const now = new Date()
    const rows = insertContactCands.map((c) => {
      const overridden = (overrides[c.email] ?? "").trim()
      const fallback = c.displayName.trim() || "(unknown)"
      return {
        id: randomUUID(),
        name: overridden || fallback,
        nameNative: nativeByEmail.get(c.email) ?? null,
        email: c.email,
        phone: phoneMapByEmail.get(c.email) ?? null,
        position: positionMapByEmail.get(c.email) ?? null,
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

  // Same fill-blanks-only pass for positions (job titles).
  let positionsEnriched = 0
  for (const [email, position] of positionMapByEmail) {
    const updated = await db
      .update(contact)
      .set({ position })
      .where(
        and(
          eq(contact.organizationId, activeOrgId),
          ne(contact.status, "deleted"),
          sql`lower(${contact.email}) = ${email}`,
          sql`(${contact.position} IS NULL OR ${contact.position} = '')`,
        ),
      )
      .returning({ id: contact.id })
    positionsEnriched += updated.length
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
    clientsRevived: revivedClients.length,
    clientsEnriched,
    contactsCreated: createdContacts.length,
    contactsRevived: revivedContacts.length,
    linksApplied,
    scannedRowsStamped,
    nativeNamesEnriched,
    phonesEnriched,
    positionsEnriched,
    createdClients,
    createdContacts,
  }
}
