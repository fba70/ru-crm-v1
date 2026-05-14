import "server-only"
import { generateText, Output } from "ai"
import { z } from "zod"
import { PARSER_CONFIG } from "@/lib/parser-config"
import {
  assembleMarkdown,
  buildFrontmatter,
  DEFAULT_RELEVANCE,
  uniqueStrings,
  type MetadataAnalysis,
  type SourceFrontmatter,
} from "@/server/parsers/_shared"

const pdfAnalysisSchema = z.object({
  language: z
    .string()
    .describe(
      "ISO 639-1 two-letter language code of the dominant text (e.g. 'en', 'de'). Default to 'en' if mixed or uncertain.",
    ),
  summary: z
    .string()
    .describe(
      "A concise 1-3 sentence summary of what the document is about.",
    ),
  senders: z
    .array(z.string())
    .describe(
      "Authors, creators, or signatories named in the document — from the cover page, title block, byline, signature line, or metadata. Empty array if none are identifiable.",
    ),
  recipients: z
    .array(z.string())
    .describe(
      "Explicit addressees the document is directed to (e.g. 'Dear Mr. X', a memo header 'To: …'). Empty array for general-purpose publications, reports, or slide decks with no specific recipient.",
    ),
  mentions: z
    .array(z.string())
    .describe(
      "Names of every person mentioned by name anywhere in the document (including authors/recipients if named in the body). Use the form they are addressed/signed as.",
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
      "The full document body converted to clean, readable Markdown. Preserve heading hierarchy, paragraphs, lists, quotes, code blocks. Convert tables to Markdown tables; if a table is too wide/complex, fall back to a JSON code block. REMOVE repeating page headers, page footers, page numbers, running titles, watermark text, and boilerplate copyright notices — they are garbage. Do NOT include the frontmatter or a '## Content' heading — only the body content itself.",
    ),
})

export type PdfParseInput = {
  bytes: Buffer | Uint8Array
  fileName: string
  sourceId: string
  parentSourceId: string | null
  sourceSystem: string
  threadId: string | null
  sourceCreatedAt: string | null
  sourceReceivedAt: string | null
}

export type ParsedPdf = {
  markdown: string
  metadata: {
    sourceId: string
    sourceSystem: string
    fileName: string
    byteSize: number
  }
  analysis: MetadataAnalysis
}

/**
 * Parse PDF bytes into a structured markdown document matching
 * refs/parsing-sources-template.md. Caller owns fetching the bytes and
 * deciding on the source identifiers — keeps this parser universal across
 * email attachments, Google Chat attachments, Google Drive files, and
 * dropped-off files.
 */
export async function parsePdfBytes(
  input: PdfParseInput,
): Promise<ParsedPdf> {
  const { bytes, fileName } = input

  if (bytes.byteLength > PARSER_CONFIG.pdf.maxBytes) {
    throw new PdfTooLargeError(bytes.byteLength, PARSER_CONFIG.pdf.maxBytes)
  }

  const { output: analysis } = await generateText({
    model: PARSER_CONFIG.pdf.model,
    output: Output.object({ schema: pdfAnalysisSchema }),
    system:
      "You are a precise document parsing assistant. Extract structured metadata and convert the provided PDF into clean Markdown. Do not invent facts. Aggressively strip repeating headers, footers, page numbers, and watermark boilerplate — they are noise, not content.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Filename: ${fileName}\n\nExtract the structured metadata and convert the attached PDF into clean markdown per the schema.`,
          },
          {
            type: "file",
            mediaType: "application/pdf",
            data: bytes,
            filename: fileName,
          },
        ],
      },
    ],
  })

  const nowIso = new Date().toISOString()

  const frontmatterFields: SourceFrontmatter = {
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
    buildFrontmatter(frontmatterFields),
    analysis.summary,
    analysis.contentMarkdown,
  )

  return {
    markdown,
    metadata: {
      sourceId: input.sourceId,
      sourceSystem: input.sourceSystem,
      fileName,
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

export class PdfTooLargeError extends Error {
  constructor(
    public actual: number,
    public max: number,
  ) {
    super(
      `PDF is ${formatBytes(actual)} which exceeds the ${formatBytes(max)} cap`,
    )
    this.name = "PdfTooLargeError"
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
