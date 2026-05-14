// Pure string utility — no DB, no server-only imports. Lives in lib/
// (not server/) so the "use server" file `src/server/clients.ts` can
// import it without violating the all-exports-must-be-async rule.

// Common legal-entity suffixes stripped before normalising. Lowercased,
// punctuation collapsed. Order matters — longer phrases first so
// "pty ltd" strips as a unit before "ltd".
const LEGAL_SUFFIXES = [
  "incorporated",
  "limited",
  "corporation",
  "company",
  "pty ltd",
  "pty",
  "gmbh",
  "ag",
  "kg",
  "ohg",
  "ug",
  "sarl",
  "sa",
  "sas",
  "srl",
  "spa",
  "bv",
  "nv",
  "oy",
  "ab",
  "as",
  "plc",
  "llp",
  "llc",
  "ltd",
  "inc",
  "corp",
  "co",
]

/**
 * Normalise a company name for dedup. Lowercase, drop common legal
 * suffixes (one or more), collapse all non-alphanumerics to nothing.
 * Examples: "IN4COM GmbH" / "in4com" / "IN4COM, Inc." → "in4com".
 * Returns "" for pure-suffix garbage (e.g. just "GmbH"); callers
 * should drop empty results.
 */
export function normaliseCompanyName(raw: string): string {
  let s = raw.trim().toLowerCase()
  // Strip trailing parenthetical (e.g. "Acme (UK)").
  s = s.replace(/\s*\([^)]*\)\s*$/g, "")
  // Punctuation that typically wraps suffixes.
  s = s.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim()
  // Repeatedly strip suffixes (handles "Acme Inc Ltd" → "acme").
  let changed = true
  while (changed) {
    changed = false
    for (const suf of LEGAL_SUFFIXES) {
      if (s === suf) {
        return ""
      }
      if (s.endsWith(" " + suf)) {
        s = s.slice(0, -(suf.length + 1)).trim()
        changed = true
        break
      }
    }
  }
  // Final pass: keep only alphanumerics for the canonical key. Keeps
  // CJK / emoji / accented chars (Unicode letter class).
  return s.replace(/[^\p{L}\p{N}]+/gu, "")
}
