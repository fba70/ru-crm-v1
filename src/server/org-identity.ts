import "server-only"

import { db } from "@/db/drizzle"
import { organization } from "@/db/schema"
import { eq } from "drizzle-orm"
import { companyMatchKey } from "@/lib/translit-ru"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
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

      // Company keys: the org name itself, plus the second-level label of every
      // own domain (so `in4comgroup.com` contributes key `in4comgroup` even when
      // the display name "IN4COM" keys differently as `in4com` — both are own).
      const nameKey = companyMatchKey(org.name ?? "")
      if (nameKey) companyKeys.add(nameKey)
      for (const d of domains) {
        const labelKey = companyMatchKey(secondLevelLabel(d))
        if (labelKey) companyKeys.add(labelKey)
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
