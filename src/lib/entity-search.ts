// Cross-script search matching for CRM ENTITIES (clients, contacts, deals).
// Pure string utilities — no DB, no server-only imports, safe to import from
// client components and from `"use server"` modules alike.
//
// ── Why this exists ─────────────────────────────────────────────────
//
// Products got Search V2 (see refs/search-v2-plan.md + scripts/search-v2/):
// query and target are both pushed through ONE normalisation pipeline —
// `lower(immutable_unaccent(translit_cyr_lat(x)))` — then matched with OR
// semantics over a tsvector plus a pg_trgm `word_similarity >= 0.3` fuzzy
// retriever. Entities never got that. `searchEverything` matched client /
// contact / deal names with a raw `name.toLowerCase().includes(q)`, which
// fails in all the ways V2 was built to fix:
//
//   • cross-script     — «АСТ» never matches the stored «AST»
//   • punctuation      — an em-dash query vs an en-dash stored name scores 0
//   • word order       — "Богданов Евгений" vs "Евгений Богданов"
//   • one wrong token  — the whole phrase is the needle, so a single extra
//                        word ("AST Российская Алкогольная Компания" against
//                        "AST – Российская Алкогольная Компания") blanks it
//
// This module ports the same pipeline to in-memory entity lists: those lists
// are small (hundreds of rows per org) and already fully loaded by the
// callers, so a JS implementation avoids the generated columns + GIN indexes
// V2 needed for a 16.8k-row catalog. The normalisation and the 0.3 trigram
// gate are deliberately the SAME as the SQL, so the two engines agree about
// what "matches" means.

import { transliterateRu } from "@/lib/translit-ru"

// Same fuzzy gate as Search V2's trigram retriever (`word_similarity >= 0.3`).
export const FUZZY_THRESHOLD = 0.3

// Field weights, mirroring V2's tsvector `setweight` A > B > C > D. A name is
// what people search by; an alias is a real but secondary spelling; an
// email/website is a weaker signal that still has to be findable.
export const FIELD_WEIGHT = { name: 1, alias: 0.9, secondary: 0.7, weak: 0.5 }

/**
 * The single normalisation pipeline, matching the SQL
 * `lower(immutable_unaccent(translit_cyr_lat(x)))` plus V2's word splitting:
 * transliterate Cyrillic → strip combining accents → lowercase → collapse
 * every non-alphanumeric run to one space.
 *
 *   "АСТ – Российская"     → "ast rossiyskaya"
 *   "AST — Российская"     → "ast rossiyskaya"   (dash variants collapse)
 *   "Jägermeister"         → "jagermeister"
 */
export function searchNormalise(raw: string | null | undefined): string {
  if (!raw) return ""
  return transliterateRu(raw)
    .normalize("NFKD")
    // Drop combining marks — the JS equivalent of Postgres `unaccent`.
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** Normalised word tokens. Single characters are dropped as noise. */
export function searchTokens(raw: string | null | undefined): string[] {
  const n = searchNormalise(raw)
  return n ? n.split(" ").filter((t) => t.length > 1) : []
}

/**
 * pg_trgm-compatible trigram set: each word is padded with two leading and
 * one trailing space before the 3-char windows are taken, exactly as the
 * extension does, so similarity scores line up with the SQL side.
 */
export function trigrams(normalised: string): Set<string> {
  const out = new Set<string>()
  for (const word of normalised.split(" ")) {
    if (!word) continue
    const padded = `  ${word} `
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3))
  }
  return out
}

/** pg_trgm `similarity()`: shared trigrams over the union (Jaccard). */
export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a)
  const B = trigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  const union = A.size + B.size - shared
  return union === 0 ? 0 : shared / union
}

/**
 * pg_trgm `word_similarity(query, target)`: the best `similarity()` between
 * the query and any contiguous run of words in the target. That's what lets a
 * short query score well against a long name — "мартини" against "Martini
 * Rosso Vermouth" — instead of being diluted by the words it never mentioned.
 *
 * Spans are capped just past the query's own word count: a longer run can
 * only add trigrams the query lacks, which lowers the score.
 */
export function wordSimilarity(
  queryNorm: string,
  targetNorm: string,
): number {
  if (!queryNorm || !targetNorm) return 0
  const words = targetNorm.split(" ").filter(Boolean)
  if (words.length === 0) return 0
  const maxSpan = Math.min(words.length, queryNorm.split(" ").length + 2)
  let best = 0
  for (let start = 0; start < words.length; start++) {
    for (let len = 1; len <= maxSpan && start + len <= words.length; len++) {
      const span = words.slice(start, start + len).join(" ")
      const s = trigramSimilarity(queryNorm, span)
      if (s > best) best = s
    }
  }
  return best
}

// Minimum query-token length before PREFIX matching is allowed. An exact
// token match always counts.
const MIN_PREFIX_LEN = 2

/**
 * Does one query token hit any of a field's tokens?
 *
 * Prefix matching runs in ONE direction only — the query token must be a
 * prefix of a target token ("vekt" finds "vektor"), never the reverse. The
 * reverse direction looks harmless and is not: Russian one-letter
 * prepositions normalise to single-character tokens, so «в» in a description
 * became a prefix of the query "vektor" and every deal whose text contained
 * «в» scored a full-coverage match. That put Finbridge Capital, MarketLine
 * and six others into the results for «Вектор».
 */
function tokenHit(queryToken: string, targetTokens: string[]): boolean {
  return targetTokens.some(
    (vt) =>
      vt === queryToken ||
      (queryToken.length >= MIN_PREFIX_LEN && vt.startsWith(queryToken)),
  )
}

/**
 * Word-boundary-aware containment: does `needle` appear in `haystack` as a
 * whole run of tokens? Both sides are already normalised, so boundaries are
 * plain spaces.
 *
 * A raw `includes()` would be wrong in both directions. Forward: a 2-letter
 * query like "an" is a substring of half the names in a catalog. Reverse
 * (needed so pasting a full stored name back finds its row): a client named
 * "AB" would match the query "grab something" on the "ab" inside "grab".
 */
function containsAsWords(haystack: string, needle: string): boolean {
  if (!needle || !haystack) return false
  if (haystack === needle) return true
  return (
    haystack.startsWith(needle + " ") ||
    haystack.endsWith(" " + needle) ||
    haystack.includes(" " + needle + " ")
  )
}

export type SearchField = {
  value: string | null | undefined
  /** One of FIELD_WEIGHT, or any 0–1 multiplier. */
  weight: number
}

/**
 * Score one entity against a query. 0 = no match; higher is better.
 *
 * Per field, best-of three signals (V2 fuses its retrievers with RRF; in JS a
 * plain max over comparable 0–1 signals is equivalent in ordering and far
 * easier to reason about):
 *
 *   1. exact normalised equality                      → 1
 *   2. word-boundary containment, either direction        → 0.9
 *      (both directions on purpose: "AST" must find "AST – Российская …",
 *      and the full stored name pasted back must find it too)
 *   3. token coverage (OR semantics, prefix-tolerant) → up to 0.8
 *      blended with the trigram fuzzy score
 *
 * The field weight then scales the result, so a name hit outranks an email
 * hit of the same strength.
 */
export function entitySearchScore(
  query: string,
  fields: SearchField[],
): number {
  const qn = searchNormalise(query)
  if (!qn) return 0
  const qTokens = qn.split(" ").filter(Boolean)

  let best = 0
  for (const f of fields) {
    const vn = searchNormalise(f.value)
    if (!vn) continue

    let s: number
    if (vn === qn) {
      s = 1
    } else if (containsAsWords(vn, qn) || containsAsWords(qn, vn)) {
      s = 0.9
    } else {
      const vTokens = vn.split(" ").filter(Boolean)
      const hits = qTokens.filter((t) => tokenHit(t, vTokens)).length
      const coverage = qTokens.length === 0 ? 0 : hits / qTokens.length
      s = Math.max(coverage * 0.8, wordSimilarity(qn, vn))
    }

    const scored = s * f.weight
    if (scored > best) best = scored
  }
  return best
}

/**
 * Ranked-search predicate: does this entity match well enough to surface?
 * Uses the same 0.3 gate as Search V2's trigram retriever, so a fuzzy or
 * cross-script hit counts and unrelated rows don't.
 *
 * For a UI *filter* box prefer {@link entityMatchesFilter} — fuzzy hits in a
 * filter read as a bug ("why is this row here?"), whereas in a search they're
 * the point.
 */
export function entityMatchesSearch(
  query: string,
  fields: SearchField[],
): boolean {
  return entitySearchScore(query, fields) >= FUZZY_THRESHOLD
}

/**
 * Filter-box predicate: the normalisation, without the fuzzy tail. Every
 * query token must be present (as a token prefix) in some field, or the whole
 * query must be a substring of one.
 *
 * So «АСТ» finds «AST», «vektor» finds «Вектор», and an em-dash finds an
 * en-dash — but a typo shows nothing rather than a surprising row.
 */
export function entityMatchesFilter(
  query: string,
  fields: SearchField[],
): boolean {
  const qn = searchNormalise(query)
  if (!qn) return true
  const qTokens = qn.split(" ").filter(Boolean)

  const values = fields
    .map((f) => searchNormalise(f.value))
    .filter((v) => v.length > 0)
  if (values.length === 0) return false

  if (values.some((v) => containsAsWords(v, qn))) return true

  return qTokens.every((t) =>
    values.some((v) => tokenHit(t, v.split(" ").filter(Boolean))),
  )
}
