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
import {
  audioSegmentSchema,
  renderTranscript,
} from "@/server/parsers/audio"

const videoAnalysisSchema = z.object({
  language: z
    .string()
    .describe(
      "ISO 639-1 two-letter language code of the dominant spoken language (e.g. 'en', 'de'). Default to 'en' if the video has no speech or is unclear.",
    ),
  durationSeconds: z
    .number()
    .describe("Total duration of the video in seconds."),

  // ── Visual summary ─────────────────────────────────────────────────
  videoSummary: z
    .string()
    .describe(
      "A brief 2-4 sentence summary of what the video is about — topic, purpose, key takeaways.",
    ),
  videoContent: z
    .string()
    .describe(
      "The video's visual content as clean Markdown. MUST cover: setting / scene, main actors or subjects visible (with short physical or behavioural descriptions), key visual events and transitions, and the overall emotional tone (neutral, tense, cheerful, formal, …). Use sub-headings like `### Setting`, `### Actors`, `### Key moments`, `### Emotional tone` where helpful. Do NOT include the frontmatter or a '## Content' heading — only the body content itself.",
    ),

  // ── Audio transcript ───────────────────────────────────────────────
  audioSummary: z
    .string()
    .describe(
      "A brief 2-4 sentence summary of the spoken content — what was discussed, decisions made, questions raised. Empty string if the video has no speech.",
    ),
  segments: z
    .array(audioSegmentSchema)
    .describe(
      "Ordered list of utterances from the audio track, split by speaker change. Empty if the video has no speech. Use stable speaker labels across segments.",
    ),
  speakers: z
    .array(z.string())
    .describe(
      "Unique speaker labels that appear in `segments`, in first-appearance order.",
    ),

  // ── Shared metadata (applies to whole video) ───────────────────────
  mentions: z
    .array(z.string())
    .describe(
      "Names of every person mentioned by name in the audio OR visibly labelled on-screen.",
    ),
  companies: z
    .array(z.string())
    .describe(
      "Names of companies or brands mentioned in the audio OR visible in the video (logos, storefronts, packaging, UI chrome).",
    ),
  products: z
    .array(z.string())
    .describe(
      "Names of products mentioned in the audio OR visible in the video.",
    ),
  urls: z
    .array(z.string())
    .describe(
      "URLs spoken aloud OR visible on screen (captions, UI, browser chrome).",
    ),
})

export type VideoParseInput = {
  bytes: Buffer | Uint8Array
  fileName: string
  mediaType: string

  // Frontmatter fields common to both derived blocks.
  sourceSystem: string
  threadId: string | null
  sourceCreatedAt: string | null
  sourceReceivedAt: string | null

  // Identity of the video block itself.
  videoSourceId: string
  videoParentSourceId: string | null

  // Identity of the audio-from-video block. `audioParentSourceId` is
  // typically `videoSourceId` — the audio track is derived from the video,
  // not directly from the original source (email / chat / …).
  audioSourceId: string
  audioParentSourceId: string | null
}

export type ParsedVideo = {
  videoMarkdown: string
  audioMarkdown: string
  metadata: {
    videoSourceId: string
    audioSourceId: string
    fileName: string
    mediaType: string
    byteSize: number
    durationSeconds: number
    speakerCount: number
  }
  // Per-block analysis. mentions/companies/products/language are shared
  // (the LLM produces them across audio + visual jointly), but summary
  // differs per block.
  videoAnalysis: MetadataAnalysis
  audioAnalysis: MetadataAnalysis
}

/**
 * Parse MP4 bytes into two structured markdown documents in a single
 * Gemini call: one for the visual summary + description, one for the
 * diarised audio transcript. Gemini handles the split natively — no
 * ffmpeg / audio-extraction step needed.
 *
 * Universal across source systems — caller owns fetching bytes and
 * deciding both source identifiers (the video's and the derived audio's).
 */
export async function parseVideoBytes(
  input: VideoParseInput,
): Promise<ParsedVideo> {
  const { bytes, fileName, mediaType } = input

  if (bytes.byteLength > PARSER_CONFIG.video.maxBytes) {
    throw new VideoTooLargeError(
      bytes.byteLength,
      PARSER_CONFIG.video.maxBytes,
    )
  }

  if (!isSupportedVideoType(mediaType, fileName)) {
    throw new UnsupportedVideoTypeError(mediaType)
  }

  const { output: analysis } = await generateText({
    model: PARSER_CONFIG.video.model,
    output: Output.object({ schema: videoAnalysisSchema }),
    system:
      "You are a precise video parsing assistant. Analyse the provided video both visually and aurally. Produce a faithful visual description AND a faithful diarised transcript of any speech. Extract structured metadata. Never fabricate facts that are not present in the video.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Filename: ${fileName}\n\nAnalyse the attached video and return the structured fields per the schema. The video block fields (videoSummary, videoContent) describe the visual content; the audio block fields (audioSummary, segments, speakers) transcribe the audio track with speaker diarisation and timestamps. If there's no speech, return empty audioSummary, empty segments, empty speakers. Keep speaker labels stable across segments.`,
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

  const segments = analysis.segments.map((s) => ({
    ...s,
    speaker: s.speaker.trim() || "Unknown",
    transcript: s.transcript.trim(),
  }))
  const speakers = uniqueStrings(
    segments.length > 0 ? segments.map((s) => s.speaker) : analysis.speakers,
  )

  const nowIso = new Date().toISOString()

  // ── Video block ────────────────────────────────────────────────────
  const videoFrontmatter: SourceFrontmatter = {
    sourceId: input.videoSourceId,
    parentSourceId: input.videoParentSourceId,
    threadId: input.threadId,
    sourceSystem: input.sourceSystem,
    sourceCreatedAt: input.sourceCreatedAt,
    sourceReceivedAt: input.sourceReceivedAt ?? nowIso,
    processedAt: nowIso,
    language: analysis.language || "en",
    // Speakers are the content authors of the video when there's speech.
    // Silent videos get an empty list — the model's `videoContent` still
    // describes the visible actors in prose.
    senders: speakers,
    recipients: [],
    mentions: uniqueStrings(analysis.mentions),
    companies: uniqueStrings(analysis.companies),
    products: uniqueStrings(analysis.products),
    urls: uniqueStrings(analysis.urls),
  }
  const videoMarkdown = assembleMarkdown(
    buildFrontmatter(videoFrontmatter),
    analysis.videoSummary,
    analysis.videoContent,
  )

  // ── Audio-from-video block ─────────────────────────────────────────
  const audioFrontmatter: SourceFrontmatter = {
    sourceId: input.audioSourceId,
    parentSourceId: input.audioParentSourceId,
    threadId: input.threadId,
    sourceSystem: input.sourceSystem,
    sourceCreatedAt: input.sourceCreatedAt,
    sourceReceivedAt: input.sourceReceivedAt ?? nowIso,
    processedAt: nowIso,
    language: analysis.language || "en",
    senders: speakers,
    recipients: [],
    mentions: uniqueStrings(analysis.mentions),
    companies: uniqueStrings(analysis.companies),
    products: uniqueStrings(analysis.products),
    urls: uniqueStrings(analysis.urls),
  }
  const transcriptBody = renderTranscript({
    durationSeconds: analysis.durationSeconds,
    segments,
  })
  const audioSummary =
    analysis.audioSummary.trim() ||
    (segments.length === 0
      ? "The video contains no speech."
      : "Transcript of the audio track of the video.")
  const audioMarkdown = assembleMarkdown(
    buildFrontmatter(audioFrontmatter),
    audioSummary,
    transcriptBody,
  )

  const sharedFields = {
    language: analysis.language || "en",
    mentions: uniqueStrings(analysis.mentions),
    companies: uniqueStrings(analysis.companies),
    products: uniqueStrings(analysis.products),
    relevance: DEFAULT_RELEVANCE,
  }

  return {
    videoMarkdown,
    audioMarkdown,
    metadata: {
      videoSourceId: input.videoSourceId,
      audioSourceId: input.audioSourceId,
      fileName,
      mediaType,
      byteSize: bytes.byteLength,
      durationSeconds: analysis.durationSeconds,
      speakerCount: speakers.length,
    },
    videoAnalysis: { ...sharedFields, summary: analysis.videoSummary },
    audioAnalysis: { ...sharedFields, summary: audioSummary },
  }
}

export function isSupportedVideoType(
  mediaType: string,
  fileName: string,
): boolean {
  if (PARSER_CONFIG.video.supportedMediaTypes.includes(mediaType.toLowerCase()))
    return true
  const lower = fileName.toLowerCase()
  return PARSER_CONFIG.video.supportedExtensions.some((ext) =>
    lower.endsWith(ext),
  )
}

export class VideoTooLargeError extends Error {
  constructor(
    public actual: number,
    public max: number,
  ) {
    super(
      `Video is ${formatBytes(actual)} which exceeds the ${formatBytes(max)} cap`,
    )
    this.name = "VideoTooLargeError"
  }
}

export class UnsupportedVideoTypeError extends Error {
  constructor(public mediaType: string) {
    super(`Unsupported video media type: ${mediaType}`)
    this.name = "UnsupportedVideoTypeError"
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
