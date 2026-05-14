// Pure string utilities for matching contact emails to client websites
// by domain. No DB, no server-only imports.

/**
 * Extract the lowercased domain part from an email address.
 * Returns "" for malformed input.
 */
export function extractEmailDomain(email: string): string {
  const at = email.indexOf("@")
  if (at < 1 || at === email.length - 1) return ""
  return email.slice(at + 1).trim().toLowerCase()
}

/**
 * Extract the lowercased apex/host domain from a website URL.
 * Strips protocol, the leading `www.`, path, query, and fragment.
 *
 *   "https://www.truffalo.ai/about?utm=x" → "truffalo.ai"
 *   "truffalo.ai" → "truffalo.ai"
 *   "https://blog.example.com/" → "blog.example.com"
 *   "" or malformed → ""
 */
export function extractWebsiteDomain(url: string): string {
  let s = url.trim().toLowerCase()
  if (!s) return ""
  // Strip protocol (http://, https://, ftp://, etc.)
  s = s.replace(/^[a-z][a-z0-9+\-.]*:\/\//, "")
  // Drop everything from the first /, ?, or # onwards.
  const cut = s.search(/[/?#]/)
  if (cut >= 0) s = s.slice(0, cut)
  // Strip leading "www." (single level only — keep "blog.acme.com").
  s = s.replace(/^www\./, "")
  // Strip trailing dot (FQDN form).
  s = s.replace(/\.$/, "")
  return s
}

// Public free-mail / consumer email providers. Their domains may match
// real client websites by accident (e.g. someone setting their client's
// webUrl to "https://gmail.com"); we treat any contact at one of these
// as un-linkable to avoid false positives. The list covers the most
// common globally — extend if you encounter regional gaps in practice.
const FREEMAIL_DOMAINS = new Set([
  // Google
  "gmail.com",
  "googlemail.com",
  // Yahoo (global + common locales)
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "yahoo.co.uk",
  "yahoo.co.jp",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.es",
  "yahoo.it",
  "yahoo.com.br",
  "yahoo.ca",
  // Microsoft
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "outlook.com",
  "outlook.fr",
  "outlook.de",
  "live.com",
  "live.co.uk",
  "msn.com",
  // Apple
  "icloud.com",
  "me.com",
  "mac.com",
  // AOL
  "aol.com",
  // Proton
  "protonmail.com",
  "proton.me",
  // Generic / regional
  "mail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "mail.ru",
])

/** True when the domain is a known consumer / free-mail provider. */
export function isFreemailDomain(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain.trim().toLowerCase())
}

/**
 * Subdomain-tolerant domain match. Returns true when the email's domain
 * equals the client's domain OR is a subdomain of it. Both arguments
 * should already be lowercased (from extractEmailDomain / extractWebsiteDomain).
 *
 *   match("alice@truffalo.ai", "truffalo.ai") → true
 *   match("alice@blog.truffalo.ai", "truffalo.ai") → true (subdomain)
 *   match("alice@truffalo.ai.evil.com", "truffalo.ai") → false (suffix not boundary)
 *   match("alice@truffalo.com", "truffalo.ai") → false (different TLD)
 */
export function domainMatches(emailDomain: string, clientDomain: string): boolean {
  if (!emailDomain || !clientDomain) return false
  if (emailDomain === clientDomain) return true
  // Boundary-aware suffix: emailDomain must end with ".clientDomain"
  // (the dot prevents `truffalo.ai.evil.com` matching `truffalo.ai`).
  return emailDomain.endsWith("." + clientDomain)
}
