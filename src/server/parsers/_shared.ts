import "server-only"

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
