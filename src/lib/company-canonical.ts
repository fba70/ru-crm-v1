// Pure helpers for collapsing the many spellings/URL-forms of ONE real company
// into a single canonical identity, used by discovery's client dedup. No DB, no
// server-only imports — safe to unit-test in isolation.

/** A company mention pulled off a source_item's metadata. `authoritative` is
 *  true for entries from `organizations[]` (they carry the real name + aliases
 *  + webUrl) and false for bare `companies[]` strings — used to prefer the real
 *  org name over an alias when picking a candidate's display name. */
export type CompanySignal = {
  spelling: string
  aliases: string[]
  webUrl: string
  authoritative: boolean
}

/** Pull the company signals off a source_item's metadata: the flat
 *  `companies: string[]` list plus the enriched `organizations[]` list
 *  (name + aliases + webUrl). Shared by the canonicalisation pre-pass and the
 *  main aggregation loop so both see exactly the same signals. */
export function extractCompanySignals(
  meta: Record<string, unknown>,
): CompanySignal[] {
  const out: CompanySignal[] = []
  const rawCompanies = meta.companies
  if (Array.isArray(rawCompanies)) {
    for (const item of rawCompanies) {
      if (typeof item !== "string") continue
      const name = item.trim()
      if (name)
        out.push({ spelling: name, aliases: [], webUrl: "", authoritative: false })
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
        ? rec.aliases
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim())
            .filter(Boolean)
        : []
      const webUrl = (typeof rec.webUrl === "string" ? rec.webUrl : "").trim()
      out.push({ spelling: name, aliases, webUrl, authoritative: true })
    }
  }
  return out
}

/** Minimal union-find over company match-keys. Collapses spellings the parser
 *  tied together — declared aliases AND a shared website domain — into one
 *  canonical class, so the same real company under two names ("NGR Softlab" +
 *  its alias "NGR Администрация") or two URL forms (www vs apex, both normalise
 *  to one domain) becomes a SINGLE candidate instead of two clients. */
export class CompanyUnionFind {
  private parent = new Map<string, string>()
  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key)
  }
  find(key: string): string {
    this.add(key)
    let root = key
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    // Path-compress so repeated lookups stay flat.
    let cur = key
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }
  /** Merge `child`'s class into `parentKey`'s class (parentKey stays the root
   *  when both are fresh — lets callers keep the authoritative name as root). */
  union(child: string, parentKey: string): void {
    const rc = this.find(child)
    const rp = this.find(parentKey)
    if (rc !== rp) this.parent.set(rc, rp)
  }
}
