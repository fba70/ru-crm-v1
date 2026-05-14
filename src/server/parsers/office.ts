import "server-only"
import { generateText, Output } from "ai"
import { z } from "zod"
import mammoth from "mammoth"
import JSZip from "jszip"
import { DOMParser } from "@xmldom/xmldom"
import { PARSER_CONFIG } from "@/lib/parser-config"
import {
  assembleMarkdown,
  buildFrontmatter,
  DEFAULT_RELEVANCE,
  uniqueStrings,
  type MetadataAnalysis,
  type SourceFrontmatter,
} from "@/server/parsers/_shared"

export type OfficeFormat = "docx" | "pptx"

const officeAnalysisSchema = z.object({
  language: z
    .string()
    .describe(
      "ISO 639-1 two-letter language code of the dominant text (e.g. 'en', 'de'). Default to 'en' if mixed or unclear.",
    ),
  summary: z
    .string()
    .describe(
      "A concise 1-3 sentence summary of what the document is about.",
    ),
  senders: z
    .array(z.string())
    .describe(
      "Authors, creators, or signatories named in the document — from the cover, title, byline, or signature block. Empty array if none are identifiable.",
    ),
  recipients: z
    .array(z.string())
    .describe(
      "Explicit addressees the document is directed to (e.g. 'Dear Mr. X', memo 'To: …'). Empty array for general-purpose documents, reports, or slide decks.",
    ),
  mentions: z
    .array(z.string())
    .describe(
      "Names of every person mentioned by name anywhere in the document (including authors/recipients if named in the body).",
    ),
  companies: z
    .array(z.string())
    .describe("Names of companies or brands mentioned."),
  products: z
    .array(z.string())
    .describe("Names of products mentioned."),
  urls: z
    .array(z.string())
    .describe("URLs that appear in the document text."),
  contentMarkdown: z
    .string()
    .describe(
      "The full document body converted to clean, readable Markdown. For Word documents: preserve heading hierarchy, paragraphs, lists, bold/italic, quotes, and tables (as Markdown tables or JSON code blocks if too wide). For PowerPoint presentations: use '### Slide N' sub-headings for each slide and preserve bullet structure within slides. Do NOT include the frontmatter or a '## Content' heading — only the body content itself.",
    ),
})

export type OfficeParseInput = {
  bytes: Buffer | Uint8Array
  fileName: string
  mediaType: string
  sourceId: string
  parentSourceId: string | null
  sourceSystem: string
  threadId: string | null
  sourceCreatedAt: string | null
  sourceReceivedAt: string | null
}

export type ParsedOffice = {
  markdown: string
  metadata: {
    sourceId: string
    sourceSystem: string
    fileName: string
    mediaType: string
    format: OfficeFormat
    byteSize: number
  }
  analysis: MetadataAnalysis
}

/**
 * Parse Office bytes (.docx or .pptx) into a structured markdown document
 * matching refs/parsing-sources-template.md. Universal across source
 * systems — caller owns fetching bytes and deciding source identifiers.
 *
 * Two-stage pipeline:
 *   1. Extract content server-side (mammoth for docx → HTML; custom
 *      jszip+xmldom extractor for pptx → slide-separated text).
 *   2. Feed extracted content to Gemini 2.5 Flash for markdown cleanup +
 *      metadata extraction (same schema as the PDF parser).
 */
export async function parseOfficeBytes(
  input: OfficeParseInput,
): Promise<ParsedOffice> {
  const { bytes, fileName, mediaType } = input

  if (bytes.byteLength > PARSER_CONFIG.office.maxBytes) {
    throw new OfficeTooLargeError(
      bytes.byteLength,
      PARSER_CONFIG.office.maxBytes,
    )
  }

  const format = detectOfficeFormat(mediaType, fileName)
  if (!format) {
    throw new UnsupportedOfficeTypeError(mediaType)
  }

  const buffer =
    bytes instanceof Buffer ? bytes : Buffer.from(bytes as Uint8Array)

  // ── Stage 1: server-side extraction ───────────────────────────────
  const extracted =
    format === "docx"
      ? await extractDocxHtml(buffer)
      : await extractPptxText(buffer)

  // ── Stage 2: Gemini for cleanup + metadata ────────────────────────
  const { output: analysis } = await generateText({
    model: PARSER_CONFIG.office.model,
    output: Output.object({ schema: officeAnalysisSchema }),
    system:
      "You are a precise document parsing assistant. Convert the provided pre-extracted document content into clean Markdown and extract structured metadata. Never fabricate facts that are not present in the input. Preserve the document's structure faithfully.",
    prompt: buildLlmPrompt({ format, fileName, extracted }),
  })

  const nowIso = new Date().toISOString()
  const frontmatter: SourceFrontmatter = {
    sourceId: input.sourceId,
    parentSourceId: input.parentSourceId,
    threadId: input.threadId,
    sourceSystem: input.sourceSystem,
    sourceCreatedAt: input.sourceCreatedAt,
    sourceReceivedAt: input.sourceReceivedAt ?? nowIso,
    processedAt: nowIso,
    language: analysis.language || "en",
    senders: uniqueStrings(analysis.senders),
    recipients: uniqueStrings(analysis.recipients),
    mentions: uniqueStrings(analysis.mentions),
    companies: uniqueStrings(analysis.companies),
    products: uniqueStrings(analysis.products),
    urls: uniqueStrings(analysis.urls),
  }

  const markdown = assembleMarkdown(
    buildFrontmatter(frontmatter),
    analysis.summary,
    analysis.contentMarkdown,
  )

  return {
    markdown,
    metadata: {
      sourceId: input.sourceId,
      sourceSystem: input.sourceSystem,
      fileName,
      mediaType,
      format,
      byteSize: bytes.byteLength,
    },
    analysis: {
      language: analysis.language || "en",
      summary: analysis.summary,
      mentions: uniqueStrings(analysis.mentions),
      companies: uniqueStrings(analysis.companies),
      products: uniqueStrings(analysis.products),
      relevance: DEFAULT_RELEVANCE,
    },
  }
}

function buildLlmPrompt(args: {
  format: OfficeFormat
  fileName: string
  extracted: string
}): string {
  const { format, fileName, extracted } = args
  // Guardrail against pathological extractions — if a doc has 200 pages of
  // boilerplate, clip the tail rather than blow out the Gemini context.
  const MAX_CHARS = 120_000
  const clipped =
    extracted.length > MAX_CHARS
      ? `${extracted.slice(0, MAX_CHARS)}\n\n[...truncated, ${extracted.length - MAX_CHARS} additional characters omitted]`
      : extracted

  if (format === "docx") {
    return [
      `Filename: ${fileName}`,
      `Format: Microsoft Word (.docx) — pre-extracted as HTML.`,
      "",
      "Convert the HTML below into clean Markdown (preserve headings, lists, tables, bold/italic). Strip empty/tracking elements. Extract the structured metadata per the schema.",
      "",
      "--- BEGIN HTML ---",
      clipped,
      "--- END HTML ---",
    ].join("\n")
  }

  return [
    `Filename: ${fileName}`,
    `Format: Microsoft PowerPoint (.pptx) — pre-extracted with slide separators.`,
    "",
    "Reformat the slide text below as clean Markdown with a `### Slide N` heading per slide (matching the numbers in the separators). Preserve bullet structure within each slide. Extract the structured metadata per the schema.",
    "",
    "--- BEGIN SLIDES ---",
    clipped,
    "--- END SLIDES ---",
  ].join("\n")
}

async function extractDocxHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer })
  // mammoth returns warnings for unrecognised styles etc. — not fatal,
  // but surface the first one in dev to help tune style maps later.
  if (result.messages.length > 0 && process.env.NODE_ENV !== "production") {
    console.warn(
      `[office/docx] mammoth warnings (${result.messages.length}):`,
      result.messages[0].message,
    )
  }
  return result.value
}

/**
 * Extract slide text from a pptx. A pptx is a ZIP; slide N lives at
 * `ppt/slides/slideN.xml` and its text is inside `<a:t>` elements.
 * Speaker notes live in `ppt/notesSlides/` — skipped for now.
 */
async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const slideEntries = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
    .map((f) => {
      const m = f.match(/slide(\d+)\.xml$/i)
      return { path: f, index: m ? parseInt(m[1], 10) : 0 }
    })
    .sort((a, b) => a.index - b.index)

  if (slideEntries.length === 0) {
    throw new Error("No slides found in .pptx archive")
  }

  const parser = new DOMParser()
  const parts: string[] = []

  for (const entry of slideEntries) {
    const file = zip.file(entry.path)
    if (!file) continue
    const xml = await file.async("string")
    const doc = parser.parseFromString(xml, "application/xml")
    // `<a:t>` = text runs in DrawingML. One element per styled span, so a
    // single paragraph may be split across several <a:t>s — join them with
    // a space, then use newlines to split paragraphs (empty <a:t> between
    // shapes manifests as an extra separator which we collapse later).
    const textNodes = doc.getElementsByTagName("a:t")
    const texts: string[] = []
    for (let i = 0; i < textNodes.length; i++) {
      const t = textNodes.item(i)?.textContent ?? ""
      if (t) texts.push(t)
    }
    const slideText = texts.join("\n").replace(/\n{3,}/g, "\n\n").trim()
    parts.push(
      `=== Slide ${entry.index} ===\n${slideText || "(no text on this slide)"}`,
    )
  }

  return parts.join("\n\n")
}

export function isSupportedOfficeType(
  mediaType: string,
  fileName: string,
): boolean {
  if (
    PARSER_CONFIG.office.supportedMediaTypes.includes(mediaType.toLowerCase())
  )
    return true
  const lower = fileName.toLowerCase()
  return PARSER_CONFIG.office.supportedExtensions.some((ext) =>
    lower.endsWith(ext),
  )
}

export function detectOfficeFormat(
  mediaType: string,
  fileName: string,
): OfficeFormat | null {
  const ct = mediaType.toLowerCase()
  const fn = fileName.toLowerCase()
  if (
    ct ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fn.endsWith(".docx")
  ) {
    return "docx"
  }
  if (
    ct ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    fn.endsWith(".pptx")
  ) {
    return "pptx"
  }
  return null
}

export class OfficeTooLargeError extends Error {
  constructor(
    public actual: number,
    public max: number,
  ) {
    super(
      `Office document is ${formatBytes(actual)} which exceeds the ${formatBytes(max)} cap`,
    )
    this.name = "OfficeTooLargeError"
  }
}

export class UnsupportedOfficeTypeError extends Error {
  constructor(public mediaType: string) {
    super(`Unsupported Office media type: ${mediaType}`)
    this.name = "UnsupportedOfficeTypeError"
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
