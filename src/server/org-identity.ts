import "server-only"

import { db } from "@/db/drizzle"
import { organization, member, user } from "@/db/schema"
import { eq } from "drizzle-orm"
import { companyMatchKey } from "@/lib/translit-ru"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
  isFreemailDomain,
} from "@/lib/email-domain"

/**
 * The CRM owner's OWN identity — its website domain(s), contact-email domain,
 * and company-name match-keys — derived from the `organization` profile
 * (the `name` / `web_url` / `email` fields the operator fills in on `/account`
 * or `/settings`).
 *
 * Used to keep the owner's own company from being mistaken for a client. Emails
 * are usually addressed TO the owner's mailbox (e.g. `in4@in4comgroup.com`), so
 * the owner's domain is the single business domain in many threads — without
 * this guard the owner's own company surfaces as a client, its website gets
 * stamped onto whatever external company the thread is about, and its mailbox
 * shows up as a contact. Consumed by both parse-time metadata extraction
 * (`parseSourceItem`) and discovery (`previewDiscovery` / `applyDiscovery`).
 */
export type OwnOrgIdentity = {
  /** True when `domain` is (or is a sub/parent of) one of the owner's domains. */
  isOwnDomain: (domain: string) => boolean
  /** True when `key` is one of the owner's company match-keys. */
  isOwnCompanyKey: (key: string) => boolean
  /** Whether the org profile carried any usable identity at all. */
  hasIdentity: boolean
}

/** The label immediately before the TLD: "in4comgroup.com" → "in4comgroup". */
function secondLevelLabel(domain: string): string {
  const parts = domain.split(".").filter(Boolean)
  if (parts.length < 2) return ""
  return parts[parts.length - 2]
}

export async function loadOwnOrgIdentity(
  orgId: string | null,
): Promise<OwnOrgIdentity> {
  const domains = new Set<string>()
  const companyKeys = new Set<string>()

  if (orgId) {
    const rows = await db
      .select({
        name: organization.name,
        webUrl: organization.webUrl,
        email: organization.email,
      })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1)
    const org = rows[0]
    if (org) {
      const webDomain = org.webUrl ? extractWebsiteDomain(org.webUrl) : ""
      if (webDomain) domains.add(webDomain)
      const emailDomain = org.email ? extractEmailDomain(org.email) : ""
      if (emailDomain) domains.add(emailDomain)

      // Company keys: the org name itself, PLUS — for every own domain — both
      // its second-level label AND the full domain string. The LLM frequently
      // emits the owner's domain verbatim as a "company" (e.g. `in4comgroup.com`
      // in metadata_json.companies); `companyMatchKey` keeps the TLD, so the
      // full domain keys as `in4comgroupcom` while the display name "IN4COM"
      // keys as `in4com` and the label as `in4comgroup` — all three must count
      // as own, otherwise the owner's own company leaks in as a client candidate
      // (which then steals webUrl inference + makes contact↔client links
      // ambiguous, breaking auto-linking). See refs/discovery + the АСТ case.
      const nameKey = companyMatchKey(org.name ?? "")
      if (nameKey) companyKeys.add(nameKey)
      for (const d of domains) {
        const labelKey = companyMatchKey(secondLevelLabel(d))
        if (labelKey) companyKeys.add(labelKey)
        const fullKey = companyMatchKey(d)
        if (fullKey) companyKeys.add(fullKey)
      }
    }
  }

  return {
    hasIdentity: domains.size > 0 || companyKeys.size > 0,
    isOwnDomain: (domain: string) => {
      if (!domain) return false
      for (const own of domains) {
        if (domain === own || domainMatches(domain, own)) return true
      }
      return false
    },
    isOwnCompanyKey: (key: string) => !!key && companyKeys.has(key),
  }
}

// ── Org identity for authorship attribution (refs/org-attribution.md) ──
//
// Distinct from OwnOrgIdentity above: this resolves WHO COUNTS AS "US" for the
// parse-time author classifier — the org's human-member emails + the
// non-freemail domains it owns. Same `organization` source as OwnOrgIdentity
// (different consumer), but it also reads the `member` → `user` join, so it
// gets its own ~5-min in-process memo: a batch parse of many items for one org
// loads it once. `invalidateOrgIdentity(orgId)` drops the entry (wire it to
// member/profile mutations to recognise a new teammate before the TTL).
export type OrgIdentity = {
  organizationId: string
  name: string | null
  url: string | null
  address: string | null
  // Non-freemail domains owned by the org (member domains + website + contact).
  emailDomains: string[]
  // Lowercased human-member emails (agent service accounts excluded).
  memberEmails: Set<string>
}

const IDENTITY_TTL_MS = 5 * 60 * 1000
const identityCache = new Map<
  string,
  { value: OrgIdentity | null; expires: number }
>()

export function invalidateOrgIdentity(orgId: string): void {
  identityCache.delete(orgId)
}

export async function getOrgIdentity(
  orgId: string,
): Promise<OrgIdentity | null> {
  const now = Date.now()
  const cached = identityCache.get(orgId)
  if (cached && cached.expires > now) return cached.value

  const orgRows = await db
    .select({
      id: organization.id,
      name: organization.name,
      webUrl: organization.webUrl,
      email: organization.email,
      address: organization.address,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1)
  const org = orgRows[0]
  if (!org) {
    identityCache.set(orgId, { value: null, expires: now + IDENTITY_TTL_MS })
    return null
  }

  // Member emails — every member → user email, lowercased. Synthetic agent
  // service accounts (`user.role === 'agent'`) are excluded so their address
  // never reads as "us".
  const memberRows = await db
    .select({ email: user.email, role: user.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId))

  const memberEmails = new Set<string>()
  const emailDomains = new Set<string>()
  for (const m of memberRows) {
    if (m.role === "agent") continue
    const email = (m.email ?? "").trim().toLowerCase()
    if (!email || !email.includes("@")) continue
    memberEmails.add(email)
    const domain = extractEmailDomain(email)
    // A member on @gmail.com must NOT contribute gmail.com as an owned domain.
    if (domain && !isFreemailDomain(domain)) emailDomains.add(domain)
  }

  // Plus the org website host + declared contact-email domain (freemail-guarded).
  const webDomain = org.webUrl ? extractWebsiteDomain(org.webUrl) : ""
  if (webDomain && !isFreemailDomain(webDomain)) emailDomains.add(webDomain)
  const contactDomain = org.email ? extractEmailDomain(org.email) : ""
  if (contactDomain && !isFreemailDomain(contactDomain)) {
    emailDomains.add(contactDomain)
  }

  const value: OrgIdentity = {
    organizationId: org.id,
    name: org.name ?? null,
    url: org.webUrl ?? null,
    address: org.address ?? null,
    emailDomains: [...emailDomains],
    memberEmails,
  }
  identityCache.set(orgId, { value, expires: now + IDENTITY_TTL_MS })
  return value
}
