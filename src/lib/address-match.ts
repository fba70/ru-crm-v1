// Pure address normalisation + fuzzy containment matching. No DB, no
// server-only imports — safe to import anywhere (the org-identity dialog
// previews the match key client-side).
//
// Motivation: the own-organisation registry lets an owner declare the org's
// postal address(es) so a document that carries OUR address reads as ours
// rather than as some new client's. Addresses are written a dozen ways —
// "г. Москва, ул. Ленина, д. 5, оф. 301" / "Moscow, Lenina st. 5" /
// "ул Ленина 5, Москва" — so exact string comparison is useless. We reduce
// both sides to a token SET (transliterated, noise words dropped) and require
// a strong overlap.
//
// Deliberately conservative: an address hit is only ever a MEDIUM own_org
// signal (see `classifyOrgAttribution`), never enough on its own to beat
// sender-based evidence. A third-party invoice that prints our billing address
// must not read as authored by us.

import { transliterateRu } from "@/lib/translit-ru"

// Address-noise tokens, in transliterated form. These carry no discriminating
// power ("street", "building", "office") and appear in every address, so they
// are dropped before keying. Kept deliberately small — over-stripping loses
// real street names (e.g. "Sadovaya" must survive).
const NOISE_TOKENS = new Set([
  // RU (transliterated by transliterateRu)
  "g", "gor", "gorod", "ul", "ulitsa", "d", "dom", "vl", "vladenie",
  "str", "stroenie", "korp", "korpus", "kor", "of", "ofis", "pom",
  "pomeschenie", "kv", "kvartira", "prosp", "prospekt", "pr", "sh",
  "shosse", "per", "pereulok", "nab", "naberezhnaya", "bulv", "bulvar",
  "pl", "ploschad", "mkr", "mikroraion", "obl", "oblast", "raion", "etazh",
  "rossiya", "rf",
  // EN
  "street", "st", "ave", "avenue", "road", "rd", "blvd", "boulevard",
  "lane", "ln", "drive", "dr", "suite", "ste", "floor", "fl", "office",
  "room", "unit", "building", "bldg", "block", "po", "box", "apt",
  "apartment", "city", "region", "district",
  // DE / generic
  "strasse", "str", "platz", "weg", "gmbh",
])

// Noise markers whose FOLLOWING number is an interior locator (office, flat,
// floor, room). Those are dropped with the marker: a letterhead prints
// "ул. Ленина, д. 5, оф. 301" but an email signature usually stops at the
// building, and requiring "301" would make the address never match.
// The building / postal numbers that survive are the discriminating ones.
const INTERIOR_NUMBER_MARKERS = new Set([
  "of", "ofis", "office", "kv", "kvartira", "apt", "apartment", "pom",
  "pomeschenie", "suite", "ste", "room", "unit", "floor", "fl", "etazh",
])

/** Minimum length for an alphabetic token to count as discriminating. */
const MIN_ALPHA_LEN = 3

// Share of the address's alphabetic tokens that must appear in the text.
const MIN_COVERAGE = 0.6
// …and at least this many of them, so a one-word overlap can never fire.
const MIN_ALPHA_HITS = 2

/**
 * Split any text into normalised address-ish tokens: transliterate Cyrillic,
 * lowercase, replace every non-alphanumeric run with a break, drop noise
 * tokens and 1-2 letter fragments (but KEEP numbers — building and postal
 * numbers are the most discriminating part of an address).
 */
export function addressTokens(raw: string): string[] {
  if (!raw) return []
  const flat = transliterateRu(raw)
  const parts = flat.split(/[^a-z0-9]+/i).filter(Boolean)
  const out: string[] = []
  let dropNextNumber = false
  for (const p of parts) {
    const t = p.toLowerCase()
    if (/^\d+$/.test(t) || /^\d+[a-z]$/.test(t)) {
      // Mixed alphanumeric like "5a" / "12b" is a building number — kept.
      if (dropNextNumber) {
        dropNextNumber = false
        continue
      }
      out.push(t)
      continue
    }
    dropNextNumber = INTERIOR_NUMBER_MARKERS.has(t)
    if (t.length < MIN_ALPHA_LEN) continue
    if (NOISE_TOKENS.has(t)) continue
    out.push(t)
  }
  return out
}

/**
 * Canonical dedup key for one declared address: significant tokens, sorted, so
 * "Москва, Ленина 5" and "ул. Ленина 5, г. Москва" key identically. Used as
 * the unique key of an `org_identity_entry` row.
 */
export function addressMatchKey(raw: string): string {
  const tokens = addressTokens(raw)
  if (tokens.length === 0) return ""
  return [...new Set(tokens)].sort().join(" ")
}

/**
 * Does `text` contain this address? Both sides are tokenised the same way;
 * a hit requires
 *   • at least ONE numeric token present when the address has any (the house
 *     or postal number — "Ленина 7" must not match "Ленина 5"), and
 *   • at least MIN_ALPHA_HITS alphabetic tokens present, and
 *   • MIN_COVERAGE of the alphabetic tokens present.
 *
 * Only one numeric is required, not all: a signature commonly prints the
 * building but drops the postcode (or vice versa). Interior numbers (office /
 * flat) were already dropped at tokenisation, so what remains is discriminating
 * either way, and the alphabetic gates carry most of the weight.
 *
 * An address with fewer than MIN_ALPHA_HITS alphabetic tokens can never match
 * (too weak to be evidence) — returns false rather than firing on "Москва 5".
 */
export function addressMatchesText(addressKey: string, text: string): boolean {
  if (!addressKey || !text) return false
  const addrTokens = addressKey.split(" ").filter(Boolean)
  if (addrTokens.length === 0) return false

  const alpha = addrTokens.filter((t) => !/^\d/.test(t))
  const numeric = addrTokens.filter((t) => /^\d/.test(t))
  if (alpha.length < MIN_ALPHA_HITS) return false

  const haystack = new Set(addressTokens(text))
  if (haystack.size === 0) return false

  if (numeric.length > 0 && !numeric.some((n) => haystack.has(n))) return false
  const hits = alpha.filter((t) => haystack.has(t)).length
  if (hits < MIN_ALPHA_HITS) return false
  return hits / alpha.length >= MIN_COVERAGE
}
