import "server-only"
import { z } from "zod"

// Junk classification — only the email parser populates this with real
// values (it's the one provider where automated/transactional mail is
// noise). Every other parser writes DEFAULT_RELEVANCE so consumers
// reading source_item.metadata_json see a uniform shape.
export type MetadataRelevance = {
  isJunk: boolean
  category: string | null
  reason: string
}

export const DEFAULT_RELEVANCE: MetadataRelevance = {
  isJunk: false,
  category: null,
  reason: "",
}

// Subset of the LLM analysis result that's denormalised onto
// source_item.metadata_json at parse time (in addition to the YAML
// frontmatter inside the parsed markdown body). contentMarkdown is
// deliberately excluded — it lives only in the markdown body / R2
// blob and would bloat the metadata column for no search benefit.
export type MetadataAnalysis = {
  language: string
  summary: string
  mentions: string[]
  companies: string[]
  products: string[]
  relevance: MetadataRelevance
  // Body-mentioned third parties extracted by the parser's LLM call.
  // Filtered to high-confidence + non-empty email before persist (see
  // filterMentionedPeople). Read by discovery.ts as a third participant
  // source after canonical participants + Nylas envelope.
  mentionedPeople: MentionedPerson[]
  // Details recovered for ENVELOPE participants from the body, paired to
  // their email by the parser's LLM: native-language name (signature /
  // sign-off / letterhead), phone number, and job title / position.
  // Email-specific — only `text.ts` populates this today, so it's optional;
  // other parsers omit the key. Discovery uses it to set
  // `contact.name_native` + `contact.phone` + `contact.position`.
  // See filterParticipantDetails.
  participantDetails?: ParticipantDetail[]
  // Enriched view of the companies in this item: canonical name + alternate
  // spellings (cross-script / with-or-without legal form) + website when the
  // body/signature reveals it. Optional — parsers that can extract it populate
  // it; others omit the key (discovery falls back to the flat `companies`
  // list). Drives client dedup-by-alias, web-URL attribution and contact↔
  // client linking in discovery. See filterOrganizations.
  organizations?: OrganizationDetail[]
  // Authoritative participant roster recovered from a calendar (.ics) invite
  // carried by the email (organizer + attendees). Only the email parsers
  // populate this, and only when the message has a real VEVENT; all other
  // rows omit the key. Discovery's `extractParticipants` already reads
  // `metadata_json.participants: [{email,name}]` and dedups it against the
  // Nylas envelope — folding an invite's roster in needs no discovery change.
  // See refs/calendar-invites.md.
  participants?: { email: string; name: string }[]
}

// An organization the LLM identified in a source item, enriched beyond the
// flat `companies` string. `name` is the best display form; `aliases` are
// other spellings of the SAME company seen in the item (e.g. the Cyrillic
// form, the form without the legal suffix, a domain-derived brand); `webUrl`
// is the company's website when the body/signature makes it determinable
// (often the sender's own email domain), else empty.
export type OrganizationDetail = {
  name: string
  aliases: string[]
  webUrl: string
}

export const organizationDetailSchema = z.object({
  name: z
    .string()
    .describe(
      "Best display name of the company (prefer the fullest, most official form actually present in the text).",
    ),
  aliases: z
    .array(z.string())
    .describe(
      "Other spellings of the SAME company seen in this item: the other-script form (e.g. the Cyrillic vs Latin variant), the form with/without the legal entity type (ООО/LLC/GmbH), an abbreviation, or a brand derived from the email domain. Do NOT include unrelated companies. Empty array if there is only one spelling.",
    ),
  webUrl: z
    .string()
    .describe(
      "The company's website if it is determinable from the body — e.g. a URL in the signature, or the sender's own email domain when the sender clearly belongs to this company (alice@ast-inter.ru, signing for АСТ → 'https://ast-inter.ru'). Empty string when you cannot tell. Never fabricate.",
    ),
})

// A third party referenced inside the body of a source item (not the
// author/sender, not an envelope recipient — those are captured by the
// sync-time `participants` field). Extracted by every parser's existing
// Gemini call via the shared schema + prompt below.
export type MentionedPerson = {
  name: string
  email: string // empty when not quoted in the body
  organization: string // empty when no clear attribution
  phone: string // empty when no phone is quoted in the body
  confidence: "high" | "medium"
}

export const mentionedPersonSchema = z.object({
  name: z
    .string()
    .describe(
      "Full name of the mentioned person as written in the body. Don't paraphrase.",
    ),
  email: z
    .string()
    .describe(
      "Exact email address QUOTED in the body for this person. Empty string when no email is present. Never fabricate.",
    ),
  organization: z
    .string()
    .describe(
      "Company name explicitly attributed to this person in the body (e.g. 'CEO of Acme', 'Acme's John'). Or, for a 'medium' confidence mention, the author/sender's organization when context makes the affiliation clear ('my colleague Jane'). Empty string when no clear attribution.",
    ),
  phone: z
    .string()
    .describe(
      "Phone number QUOTED in the body for this person, exactly as written (keep the country code / formatting). Empty string when no phone is present. Never fabricate or guess.",
    ),
  confidence: z
    .enum(["high", "medium"])
    .describe(
      "high = email is explicitly quoted in the body OR organization is explicitly attributed to the person. medium = organization is inferred from the author/sender's affiliation (e.g. 'my colleague Jane' said by someone at Acme → Jane at Acme). OMIT the person entirely if neither applies.",
    ),
})

// Light phone cleanup (no E.164 normalisation): trim, drop characters that
// can't appear in a dialable number, collapse whitespace. Returns "" when
// fewer than 7 digits survive (implausible as a phone number). We store the
// number close to as-written so the local formatting is preserved.
export function cleanPhone(raw: string): string {
  const s = (raw ?? "").trim()
  if (!s) return ""
  const cleaned = s
    .replace(/[^\d+()\-.\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const digitCount = (cleaned.match(/\d/g) ?? []).length
  return digitCount >= 7 ? cleaned : ""
}

// Reusable system-prompt clause. Each parser appends this PLUS a short
// provider-specific addendum naming who the author/sender is (so the LLM
// knows who NOT to include and where to source the medium-confidence
// org inference). See refs spec § "Per-parser specifics".
export const MENTIONED_PEOPLE_PROMPT = `Beyond the author/sender, scan the body for people EXPLICITLY mentioned who are likely real CRM contacts. For each, emit one entry in mentionedPeople with {name, email, organization, phone, confidence}:

- Quote email verbatim from the body if present; otherwise empty string. NEVER invent or guess an email.
- Quote phone verbatim from the body if a phone number is given for this person (e.g. on a business card or in a signature), keeping its formatting; otherwise empty string. NEVER invent or guess a phone number.
- Set organization to a company explicitly attributed to the person in the body (e.g. "CEO of Acme", "Acme's John Smith"). If the body doesn't attribute them but they're clearly part of the author/sender's own organization (e.g. "my colleague Jane", "our team's Alex"), set organization to the author's company and use confidence="medium".
- Use confidence="high" only when EITHER the email is quoted OR an explicit org attribution exists. Use confidence="medium" for the author-org-inferred case. OMIT the person entirely if neither applies (i.e. a bare name with no email and no clear affiliation).
- Do not include the author/sender themselves — they're captured elsewhere.`

// v1 persist filter (server-side, post-LLM, pre-persist): keep only
// high-confidence entries with a non-empty email, deduped by lowercased
// email. Medium-confidence + email-less entries are emitted by the model
// (future use) but dropped here — discovery dedups by email, so the
// contact-table contract needs the email. See PHASE2.md #14.
export function filterMentionedPeople(
  raw: MentionedPerson[],
): MentionedPerson[] {
  const seen = new Set<string>()
  const out: MentionedPerson[] = []
  for (const p of raw ?? []) {
    if (!p) continue
    if (p.confidence !== "high") continue
    const email = (p.email ?? "").trim().toLowerCase()
    if (!email) continue
    if (seen.has(email)) continue
    seen.add(email)
    out.push({
      name: (p.name ?? "").trim(),
      email,
      organization: (p.organization ?? "").trim(),
      phone: cleanPhone(p.phone ?? ""),
      confidence: "high",
    })
  }
  return out
}

// Details recovered for an envelope participant from the body, paired to
// their email by the LLM. `email` MUST be one of the envelope addresses;
// `nativeName` is written in its original script (not romanized/translated);
// `phone` is quoted from the body (signature); `position` is the job title /
// role as written in the body. Any enrichment may be empty.
export type ParticipantDetail = {
  email: string
  nativeName: string
  phone: string
  position: string
}

export const participantDetailSchema = z.object({
  email: z
    .string()
    .describe(
      "The envelope email address (From/To/Cc/Bcc, as listed in the prompt) these details belong to. Must be one of those addresses — never a body-only address.",
    ),
  nativeName: z
    .string()
    .describe(
      "The person's real name as written in the body in its ORIGINAL script/language (e.g. the German or Chinese form from a signature or sign-off). Do not romanize, translate, or reformat. Empty string if you can't find a body name for this address.",
    ),
  phone: z
    .string()
    .describe(
      "The phone number quoted in the body for this address (signature / contact block), exactly as written. Empty string if no phone is present. Never fabricate.",
    ),
  position: z
    .string()
    .describe(
      "The person's job title / role / position as written in the body for this address (signature / contact block / sign-off), exactly as quoted — e.g. 'Коммерческий директор', 'Head of Sales', 'CEO', 'Geschäftsführer'. Keep the original language and casing. Empty string if no title is present. Never fabricate or guess.",
    ),
})

// Reusable system-prompt clause for envelope-participant detail extraction.
// Email-specific: the envelope carries a technical/English display name while
// the writer's real name + phone appear in the body. Appended to text.ts.
export const PARTICIPANT_DETAILS_PROMPT = `Separately, recover extra details for the envelope participants from the body. The envelope From/To/Cc/Bcc addresses are listed above with their technical display names — those are often English or romanized and set by mail admins, while the person's REAL name (and often a phone number) appears in the body (signature, sign-off like "Mit freundlichen Grüßen, …", contact block, letterhead).

For each envelope address whose details you can confidently determine from the body, emit one entry in participantDetails with {email, nativeName, phone, position}:
- \`email\` MUST be one of the envelope addresses listed above (typically the From: sender, who signs the message). Never a body-only address.
- \`nativeName\` is the name exactly as written in the body, in its ORIGINAL script (German, Chinese, …). Do NOT romanize, translate, or reorder. Empty string if none.
- \`phone\` is a phone number quoted in the signature/contact block for that address, exactly as written. Empty string if none. Never fabricate.
- \`position\` is the person's job title / role as written in the body for that address (e.g. "Коммерческий директор", "Head of Sales", "CEO", "Geschäftsführer"). Keep the original language and casing. Empty string if no title is given. Never fabricate or guess.
- Only emit an entry when you're confident at least one of nativeName / phone / position belongs to that exact address. OMIT an address entirely if none maps to it.`

// v1 persist filter: keep entries whose email is an actual envelope address
// (passed in) and that carry at least one usable detail (native name, a
// plausible phone, or a position). Deduped by email (longest native name
// wins; first non-empty phone wins; longest position wins). Mirrors
// filterMentionedPeople's posture.
export function filterParticipantDetails(
  raw: ParticipantDetail[],
  envelopeEmails: Set<string>,
): ParticipantDetail[] {
  const byEmail = new Map<
    string,
    { nativeName: string; phone: string; position: string }
  >()
  for (const p of raw ?? []) {
    if (!p) continue
    const email = (p.email ?? "").trim().toLowerCase()
    if (!email || !envelopeEmails.has(email)) continue
    const nativeName = (p.nativeName ?? "").trim()
    const phone = cleanPhone(p.phone ?? "")
    const position = (p.position ?? "").trim()
    if (!nativeName && !phone && !position) continue
    const existing = byEmail.get(email)
    if (existing === undefined) {
      byEmail.set(email, { nativeName, phone, position })
    } else {
      // Longest native name wins; first non-empty phone wins; longest
      // position wins.
      if (nativeName.length > existing.nativeName.length) {
        existing.nativeName = nativeName
      }
      if (!existing.phone && phone) existing.phone = phone
      if (position.length > existing.position.length) {
        existing.position = position
      }
    }
  }
  return Array.from(byEmail.entries()).map(([email, d]) => ({
    email,
    nativeName: d.nativeName,
    phone: d.phone,
    position: d.position,
  }))
}

// Reusable system-prompt clause for enriched organization extraction.
// Appended after the flat-companies instruction. Asks the model to also emit
// one structured entry PER DISTINCT real-world company, folding spelling
// variants together rather than listing them as separate companies.
export const ORGANIZATIONS_PROMPT = `Also emit \`organizations\`: one entry per DISTINCT real-world company referenced in the message, with {name, aliases, webUrl}. This is the structured counterpart to the flat \`companies\` list — fold spelling variants of the SAME company into ONE entry (its other-script form, the form with/without legal type like ООО/LLC/GmbH, an abbreviation, or a brand visible in the email domain) and put the secondary spellings in \`aliases\`. Set \`webUrl\` from the signature, or from the sender's own email domain when the sender clearly belongs to that company (e.g. someone signing for "АСТ" from alice@ast-inter.ru → "https://ast-inter.ru"). Leave \`webUrl\` empty when you can't tell. Never fabricate a URL or an alias.`

// v1 persist filter for organizations: drop entries with no usable name,
// dedup aliases (case-insensitive, excluding the name itself), trim the
// webUrl. Keeps the shape small and clean for metadata_json.
export function filterOrganizations(
  raw: OrganizationDetail[],
): OrganizationDetail[] {
  const out: OrganizationDetail[] = []
  const seenNames = new Set<string>()
  for (const o of raw ?? []) {
    if (!o) continue
    const name = (o.name ?? "").trim()
    if (!name) continue
    const nameLower = name.toLowerCase()
    if (seenNames.has(nameLower)) continue
    seenNames.add(nameLower)
    const aliasSeen = new Set<string>([nameLower])
    const aliases: string[] = []
    for (const a of o.aliases ?? []) {
      const t = (typeof a === "string" ? a : "").trim()
      if (!t) continue
      const lower = t.toLowerCase()
      if (aliasSeen.has(lower)) continue
      aliasSeen.add(lower)
      aliases.push(t)
    }
    out.push({ name, aliases, webUrl: (o.webUrl ?? "").trim() })
  }
  return out
}

// Shape of the YAML frontmatter defined in refs/parsing-sources-template.md.
// Every source parser (email, pdf, chat, drive, …) assembles one of these
// before serialising to markdown.
export type SourceFrontmatter = {
  sourceId: string
  parentSourceId: string | null
  threadId: string | null
  sourceSystem: string
  sourceCreatedAt: string | null
  sourceReceivedAt: string | null
  processedAt: string
  language: string
  senders: string[]
  recipients: string[]
  mentions: string[]
  companies: string[]
  products: string[]
  urls: string[]
}

export function buildFrontmatter(fields: SourceFrontmatter): string {
  // Blank lines between logical groups so the block reads cleanly when
  // rendered as a yaml code block (YAML ignores blank lines between keys).
  const groups: string[][] = [
    [
      `source_id: ${yamlScalar(fields.sourceId)}`,
      `parent_source_id: ${yamlNullable(fields.parentSourceId)}`,
      `thread_id: ${yamlNullable(fields.threadId)}`,
    ],
    [`source_system: ${yamlScalar(fields.sourceSystem)}`],
    [
      `source_created_at: ${yamlNullable(fields.sourceCreatedAt)}`,
      `source_received_at: ${yamlNullable(fields.sourceReceivedAt)}`,
      `processed_at: ${yamlScalar(fields.processedAt)}`,
    ],
    [`language: ${yamlScalar(fields.language)}`],
    [yamlList("senders", fields.senders)],
    [yamlList("recipients", fields.recipients)],
    [yamlList("mentions", fields.mentions)],
    [yamlList("companies", fields.companies)],
    [yamlList("products", fields.products)],
    [yamlList("urls", fields.urls)],
  ]

  const body = groups.map((g) => g.join("\n")).join("\n\n")
  return `---\n${body}\n---`
}

export function assembleMarkdown(
  frontmatter: string,
  summary: string,
  contentMarkdown: string,
): string {
  return (
    `${frontmatter}\n\n` +
    `## Summary\n\n${summary.trim()}\n\n` +
    `## Content\n\n${contentMarkdown.trim()}\n`
  )
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const t = v.trim()
    if (!t) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')]+/gi) ?? []
  const cleaned = matches.map((u) => u.replace(/[).,;:!?]+$/g, ""))
  return uniqueStrings(cleaned)
}

export function emailsToDomainUrls(emails: string[]): string[] {
  const out: string[] = []
  for (const e of emails) {
    const at = e.lastIndexOf("@")
    if (at < 0) continue
    const domain = e.slice(at + 1).trim().toLowerCase()
    if (!domain || !domain.includes(".")) continue
    out.push(`https://${domain}`)
  }
  return out
}

function yamlList(key: string, values: string[]): string {
  if (values.length === 0) return `${key}: []`
  const items = values.map((v) => `  - ${yamlScalar(v)}`).join("\n")
  return `${key}:\n${items}`
}

function yamlScalar(value: string): string {
  // Always double-quote to keep colons, hashes, emoji etc. safe.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function yamlNullable(value: string | null): string {
  return value ? yamlScalar(value) : "null"
}
