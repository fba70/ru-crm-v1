import "server-only"
import { generateText, Output } from "ai"
import { z } from "zod"
import { PARSER_CONFIG } from "@/lib/parser-config"
import {
  assembleMarkdown,
  buildFrontmatter,
  DEFAULT_RELEVANCE,
  filterMentionedPeople,
  MENTIONED_PEOPLE_PROMPT,
  mentionedPersonSchema,
  uniqueStrings,
  type MetadataAnalysis,
  type SourceFrontmatter,
} from "@/server/parsers/_shared"

const imageAnalysisSchema = z.object({
  isBoilerplate: z
    .boolean()
    .describe(
      "True ONLY if the image is purely decorative email/UI chrome carrying no substantive information: a company logo, signature graphic, social-media icon/badge, header or footer banner, divider/spacer, or tracking pixel. False for screenshots, photos, charts/diagrams, scanned documents, receipts, product shots, whiteboards, or anything with text or content worth keeping. When unsure, return false.",
    ),
  language: z
    .string()
    .describe(
      "ISO 639-1 two-letter language code of any text visible in the image (e.g. 'en', 'de'). Default to 'en' if the image has no text or is unclear.",
    ),
  summary: z
    .string()
    .describe(
      "A concise 1-3 sentence summary describing what the image shows or what it communicates.",
    ),
  senders: z
    .array(z.string())
    .describe(
      "Authors, creators, or signatories visible in the image (e.g. a signed letter or memo, a watermark naming the author). Empty for general photos/screenshots with no such info.",
    ),
  recipients: z
    .array(z.string())
    .describe(
      "Explicit addressees visible in the image (e.g. a letter header 'To: …'). Empty for general photos/screenshots.",
    ),
  mentions: z
    .array(z.string())
    .describe(
      "Names of every person mentioned or visibly labelled in the image (including in captions, name tags, on-screen text).",
    ),
  companies: z
    .array(z.string())
    .describe(
      "Names of companies or brands visible in the image — logos, storefronts, packaging, letterheads, UI chrome.",
    ),
  products: z
    .array(z.string())
    .describe("Names of products visible in the image."),
  mentionedPeople: z
    .array(mentionedPersonSchema)
    .describe(
      "People visibly named in the image beyond the author (third parties on business cards, name plates, labelled photos). See the system prompt for emission rules.",
    ),
  urls: z
    .array(z.string())
    .describe(
      "URLs visible in the image (on screen, in captions, QR codes if legible).",
    ),
  contentMarkdown: z
    .string()
    .describe(
      "The full content of the image as clean Markdown. For photos / diagrams / UI screenshots: a detailed description of the subject, setting, and any notable elements. For text-heavy images (receipts, forms, whiteboard photos, slide screenshots): extract the text verbatim via OCR, preserving structure (headings, lists, tables as Markdown tables or JSON code blocks, code blocks). For mixed images: combine a brief description with the OCRed text under clear sub-headings. Do NOT include the frontmatter or a '## Content' heading — only the body content itself.",
    ),
})

export type ImageParseInput = {
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

export type ParsedImage = {
  markdown: string
  // The model's verdict that this image is purely decorative chrome (logo,
  // banner, icon, tracking pixel) with no substantive content. Callers may
  // use it to skip storing inline email images. See `isBoilerplate` in the
  // analysis schema.
  decorative: boolean
  metadata: {
    sourceId: string
    sourceSystem: string
    fileName: string
    mediaType: string
    byteSize: number
  }
  analysis: MetadataAnalysis
}

/**
 * Parse image bytes (JPEG/PNG) into a structured markdown document matching
 * refs/parsing-sources-template.md. Universal across source systems — caller
 * owns fetching bytes and deciding on source identifiers.
 *
 * Handles both photo-style images (via description) and text-heavy images
 * (via OCR) in a single Gemini 2.5 Flash multimodal call — the model picks
 * the right strategy per-image based on what it sees.
 */
export async function parseImageBytes(
  input: ImageParseInput,
): Promise<ParsedImage> {
  const { bytes, fileName, mediaType } = input

  if (bytes.byteLength > PARSER_CONFIG.image.maxBytes) {
    throw new ImageTooLargeError(
      bytes.byteLength,
      PARSER_CONFIG.image.maxBytes,
    )
  }

  if (!isSupportedImageType(mediaType, fileName)) {
    throw new UnsupportedImageTypeError(mediaType)
  }

  const { output: analysis } = await generateText({
    model: PARSER_CONFIG.image.model,
    output: Output.object({ schema: imageAnalysisSchema }),
    system: `You are a precise image parsing assistant. Extract structured metadata and convert the provided image into clean Markdown. For text-heavy images perform OCR faithfully; for photos/diagrams give a detailed description. Never fabricate facts that are not visible in the image.

${MENTIONED_PEOPLE_PROMPT}

For images specifically: the 'author/sender' is whoever you extract into the \`senders\` field (signature, byline, watermark). Don't include them in mentionedPeople. Only emit third parties visibly named in the image. Business cards / name plates / labelled photos with an organization shown are explicit attribution — confidence='high'. When inferring organization from the document's author, only do so if the image itself states the author's company unambiguously.`,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Filename: ${fileName}\n\nExtract the structured metadata and convert the attached image into clean markdown per the schema.`,
          },
          {
            type: "file",
            mediaType,
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
    decorative: analysis.isBoilerplate === true,
    metadata: {
      sourceId: input.sourceId,
      sourceSystem: input.sourceSystem,
      fileName,
      mediaType,
      byteSize: bytes.byteLength,
    },
    analysis: {
      language: analysis.language || "en",
      summary: analysis.summary,
      mentions: uniqueStrings(analysis.mentions),
      companies: uniqueStrings(analysis.companies),
      products: uniqueStrings(analysis.products),
      relevance: DEFAULT_RELEVANCE,
      mentionedPeople: filterMentionedPeople(analysis.mentionedPeople ?? []),
    },
  }
}

export function isSupportedImageType(
  mediaType: string,
  fileName: string,
): boolean {
  if (PARSER_CONFIG.image.supportedMediaTypes.includes(mediaType)) return true
  const lower = fileName.toLowerCase()
  return PARSER_CONFIG.image.supportedExtensions.some((ext) =>
    lower.endsWith(ext),
  )
}

export class ImageTooLargeError extends Error {
  constructor(
    public actual: number,
    public max: number,
  ) {
    super(
      `Image is ${formatBytes(actual)} which exceeds the ${formatBytes(max)} cap`,
    )
    this.name = "ImageTooLargeError"
  }
}

export class UnsupportedImageTypeError extends Error {
  constructor(public mediaType: string) {
    super(`Unsupported image media type: ${mediaType}`)
    this.name = "UnsupportedImageTypeError"
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
