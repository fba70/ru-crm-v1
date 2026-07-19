// Parse-time authorship classification of a source item (see
// refs/org-attribution.md): is this authored BY the owning org (own_org), by an
// outside party (external), or unknown? Directionality is the whole game — only
// the SENDER/author side counts; recipients of an inbound client email never
// make it ours.
//
// IMPORTANT: `import "server-only"`, NOT `"use server"`. This module exports
// sync functions + a type; `"use server"` would restrict exports to async and
// the build would fail.
import "server-only"

import { generateText, Output } from "ai"
import { z } from "zod"
import { PARSER_CONFIG } from "@/lib/parser-config"
import { getProvider } from "@/lib/sources/providers"
import type { SourceProvider } from "@/db/schema"
import type { OrgIdentity } from "@/server/org-identity"
import { loadOrgBlocklist } from "@/server/blocklist"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
  isFreemailDomain,
} from "@/lib/email-domain"

export type OrgAttributionValue = "own_org" | "external" | "unknown"

export type OrgAttributionResult = {
  value: OrgAttributionValue
  confidence: "high" | "medium" | "low"
  // Stable, searchable evidence tags (e.g. "sender_member_email", "org_url").
  matchedOn: string[]
  reason: string
}

// ── 2.1 Author extraction (registry-driven) ──────────────────────────
// Reads the provider's declared `authorEmailField` from metadata_json as an
// array of `{ email }`, lowercased + @-filtered. A `null` field → []. Pointing
// this at the SENDER field only is what keeps inbound client mail from flipping
// to own_org.
export function extractAuthorEmails(
  metadataJson: Record<string, unknown> | null,
  provider: SourceProvider,
): string[] {
  const field = getProvider(provider).authorEmailField
  if (!field) return []
  const list = (metadataJson ?? {})[field]
  if (!Array.isArray(list)) return []
  const out = new Set<string>()
  for (const p of list) {
    if (p && typeof p === "object") {
      const raw = (p as Record<string, unknown>).email
      const email = (typeof raw === "string" ? raw : "").trim().toLowerCase()
      if (email && email.includes("@")) out.add(email)
    }
  }
  return [...out]
}

// ── 2.2 Deterministic classifier ─────────────────────────────────────
// Strict priority order; first hit wins.
export function classifyOrgAttribution(input: {
  authorEmails: string[]
  contentHaystack: string
  orgIdentity: OrgIdentity | null
}): OrgAttributionResult {
  const { authorEmails, contentHaystack, orgIdentity } = input
  if (!orgIdentity) {
    return { value: "unknown", confidence: "low", matchedOn: [], reason: "No org identity" }
  }

  // 1. Author email is a known org member → ours, high.
  for (const e of authorEmails) {
    if (orgIdentity.memberEmails.has(e)) {
      return {
        value: "own_org",
        confidence: "high",
        matchedOn: ["sender_member_email"],
        reason: `Sender ${e} is an organisation member`,
      }
    }
  }

  // 2. Author's (non-freemail) domain matches an owned domain → ours, high.
  for (const e of authorEmails) {
    const d = extractEmailDomain(e)
    if (!d || isFreemailDomain(d)) continue
    for (const own of orgIdentity.emailDomains) {
      if (d === own || domainMatches(d, own)) {
        return {
          value: "own_org",
          confidence: "high",
          matchedOn: ["sender_org_domain"],
          reason: `Sender domain ${d} belongs to the organisation`,
        }
      }
    }
  }

  // 3. There IS an author and it's neither → external, high.
  if (authorEmails.length > 0) {
    return {
      value: "external",
      confidence: "high",
      matchedOn: ["external_sender"],
      reason: "Sender is an outside party",
    }
  }

  // 4. No author + the org website host appears in the content → ours, medium.
  //    (Envelope-less document case; only medium because a third-party doc
  //    could merely cite our domain — the LLM judge is the authority.)
  const host = orgIdentity.url ? extractWebsiteDomain(orgIdentity.url) : ""
  if (host && !isFreemailDomain(host) && contentHaystack.toLowerCase().includes(host)) {
    return {
      value: "own_org",
      confidence: "medium",
      matchedOn: ["org_url"],
      reason: `Document references the organisation's own domain (${host})`,
    }
  }

  // 5. Nothing.
  return { value: "unknown", confidence: "low", matchedOn: [], reason: "No authorship signal" }
}

// ── 2.3 LLM authorship judge (ambiguous document tail only) ──────────
const judgeSchema = z.object({
  verdict: z
    .enum(["own_org", "external", "unknown"])
    .describe(
      "own_org = the owning organisation PRODUCED this document; external = an outside party produced it; unknown = can't tell.",
    ),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().describe("One short sentence justifying the verdict."),
})

const JUDGE_SYSTEM = `You decide who AUTHORED a document — the owning organisation, or an outside party.

CRUCIAL: merely MENTIONING the organisation is NOT authorship. A third-party proposal, invoice, or article can name our company many times yet be produced by someone else. Judge by who PRODUCED the document:
- own_org signals: first-person "we/our" voice speaking AS the organisation, the organisation's letterhead/logo as the SENDER, a sign-off/footer from the organisation, an outbound document we wrote.
- external signals: the document is ADDRESSED TO us, signed by another company, a vendor's quote/invoice to us, a client's message, third-party marketing.

When genuinely unsure, answer "unknown" — do not guess.`

// Returns null (abstain) on any error so the deterministic verdict stands.
async function judgeOrgAuthorship(
  orgIdentity: OrgIdentity,
  markdown: string,
): Promise<OrgAttributionResult | null> {
  const content = markdown.slice(0, 8000)
  try {
    const { output } = await generateText({
      model: PARSER_CONFIG.text.model,
      output: Output.object({ schema: judgeSchema }),
      system: JUDGE_SYSTEM,
      prompt: [
        `Owning organisation: ${orgIdentity.name ?? "(unknown name)"}${orgIdentity.url ? ` — ${orgIdentity.url}` : ""}`,
        `Its owned email domains: ${orgIdentity.emailDomains.join(", ") || "(none known)"}`,
        "",
        "--- BEGIN DOCUMENT ---",
        content || "(empty)",
        "--- END DOCUMENT ---",
      ].join("\n"),
    })
    return {
      value: output.verdict,
      confidence: output.confidence,
      matchedOn: ["llm_judge"],
      reason: output.reason,
    }
  } catch {
    return null
  }
}

// ── 2.4 Orchestrator — the single entry point the pipeline calls ─────
export async function resolveOrgAttribution(input: {
  authorEmails: string[]
  contentHaystack: string
  orgIdentity: OrgIdentity | null
  organizationId?: string | null
  enableLlmJudge?: boolean
}): Promise<OrgAttributionResult> {
  // 1. Deterministic classifier.
  const deterministic = classifyOrgAttribution(input)

  // 2. Blocklist override — unless already own_org, a blocklisted author is
  //    authoritatively external (a member is never blocked, so own_org is
  //    never fought).
  if (deterministic.value !== "own_org" && input.organizationId) {
    const blocklist = await loadOrgBlocklist(input.organizationId)
    if (
      blocklist.hasEntries &&
      input.authorEmails.some((e) => blocklist.isBlockedEmail(e))
    ) {
      return {
        value: "external",
        confidence: "high",
        matchedOn: ["blocklist_author"],
        reason: "Author is on the discovery blocklist",
      }
    }
  }

  // 3. Deterministic `high` is authoritative → never pay for the LLM (email /
  //    chat with a resolvable sender is the easy 95%).
  if (deterministic.confidence === "high") return deterministic

  // 4. Skip the LLM when explicitly disabled (conversational sources where
  //    authorship is meaningless), when there's no identity, or no content.
  if (
    input.enableLlmJudge === false ||
    !input.orgIdentity ||
    !input.contentHaystack.trim()
  ) {
    return deterministic
  }

  // 5. Run the judge. Abstain (unknown) → keep any non-unknown deterministic
  //    signal (e.g. medium org_url). Otherwise the judge is the authority — it
  //    can upgrade an `unknown` document AND correct a weak `org_url` own_org
  //    when the doc is actually third-party.
  const judged = await judgeOrgAuthorship(input.orgIdentity, input.contentHaystack)
  if (!judged || judged.value === "unknown") return deterministic

  return {
    value: judged.value,
    confidence: judged.confidence,
    matchedOn: [...new Set([...deterministic.matchedOn, ...judged.matchedOn])],
    reason: judged.reason,
  }
}
