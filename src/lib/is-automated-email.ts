// Pure string utility — no DB, no server-only imports. Used by the
// contact-discovery flow on /clients to drop addresses that are 100%
// noise (mailer daemons, do-not-reply autoresponders, system bounces).
//
// We intentionally do NOT filter "info@", "sales@", "support@",
// "hello@", "contact@" and similar — those are company-generic but
// can be useful CRM contacts. The user decides via the preview
// checkbox.

// Matched against the lowercased local part (everything before `@`).
// Each entry is a prefix check, so `noreply-12345@` matches `noreply`.
const AUTOMATED_PREFIXES = [
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "do_not_reply",
  "mailer-daemon",
  "mailerdaemon",
  "mailer_daemon",
  "postmaster",
  "bounce",      // also catches "bounces", "bounce-12345"
  "bounces",
  "notification", // also "notifications", "notification-id"
  "notifications",
  "automated",
  "auto-reply",
  "autoreply",
]

// Exact-match local parts (rarer, system-only addresses).
const AUTOMATED_EXACT = new Set(["daemon", "system", "root", "abuse"])

/**
 * Returns true when the given email address is a known automated /
 * system address that should be excluded from contact discovery.
 * Empty / malformed input returns true (treated as un-actionable).
 */
export function isAutomatedEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return true
  const at = trimmed.indexOf("@")
  if (at < 1) return true
  const local = trimmed.slice(0, at)
  if (AUTOMATED_EXACT.has(local)) return true
  for (const prefix of AUTOMATED_PREFIXES) {
    if (local === prefix) return true
    // `noreply-12345@…` style — prefix followed by a separator.
    if (local.startsWith(prefix + "-") || local.startsWith(prefix + "_")) {
      return true
    }
  }
  return false
}
