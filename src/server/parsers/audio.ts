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

export const audioSegmentSchema = z.object({
  startSeconds: z
    .number()
    .describe("Start time of this segment in seconds from the beginning."),
  durationSeconds: z
    .number()
    .describe("Duration of this segment in seconds."),
  speaker: z
    .string()
    .describe(
      "Speaker label for this segment. If the speaker introduces themselves or is clearly addressed by name in the audio, use that name. Otherwise use 'Speaker 1', 'Speaker 2', … — keep labels stable across segments (same voice = same label).",
    ),
  transcript: z
    .string()
    .describe(
      "The literal transcript of what this speaker said during this segment. Preserve filler words only if they change meaning; clean up obvious transcription artefacts but do not paraphrase.",
    ),
})

const audioAnalysisSchema = z.object({
  language: z
    .string()
    .describe(
      "ISO 639-1 two-letter language code of the dominant spoken language (e.g. 'en', 'de'). Default to 'en' if mixed or unclear.",
    ),
  durationSeconds: z
    .number()
    .describe("Total duration of the audio in seconds."),
  summary: z
    .string()
    .describe(
      "A concise 2-4 sentence summary of the conversation or monologue — what was discussed, decisions made, or asks raised.",
    ),
  segments: z
    .array(audioSegmentSchema)
    .describe(
      "Ordered list of utterances, split by speaker change. Each segment is one continuous stretch of speech from one speaker.",
    ),
  speakers: z
    .array(z.string())
    .describe(
      "Unique speaker labels that appear in `segments`, in first-appearance order. If any speaker could be identified by name from the audio, use the same name used in `segments`.",
    ),
  mentions: z
    .array(z.string())
    .describe(
      "Names of every person mentioned by name in the audio (including speakers if they are addressed or introduce themselves by name).",
    ),
  companies: z
    .array(z.string())
    .describe("Names of companies or brands mentioned in the audio."),
  products: z
    .array(z.string())
    .describe("Names of products mentioned in the audio."),
  mentionedPeople: z
    .array(mentionedPersonSchema)
    .describe(
      "People referenced in the audio beyond the speakers themselves (third parties named by the speakers). See the system prompt for emission rules.",
    ),
  urls: z
    .array(z.string())
    .describe(
      "URLs spoken aloud or spelled out in the audio (if any — usually empty for voice recordings).",
    ),
})

export type AudioParseInput = {
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

export type ParsedAudio = {
  markdown: string
  // The diarised speech as plain text (no timestamps / headings), speaker-
  // prefixed only when the recording has more than one speaker. Callers that
  // need the spoken words as a message body — e.g. a Telegram voice order whose
  // `metadata_json.rawText` would otherwise be the empty caption — stamp this
  // instead of re-deriving it from the rendered markdown.
  transcript: string
  metadata: {
    sourceId: string
    sourceSystem: string
    fileName: string
    mediaType: string
    byteSize: number
    durationSeconds: number
    speakerCount: number
  }
  analysis: MetadataAnalysis
}

/**
 * Parse audio bytes (mp3) into a structured markdown document matching
 * refs/parsing-sources-template.md. Produces a diarised transcript with
 * per-segment timestamps + durations + speaker labels in addition to the
 * usual metadata fields. Universal across source systems — caller owns
 * fetching bytes and deciding source identifiers.
 */
export async function parseAudioBytes(
  input: AudioParseInput,
): Promise<ParsedAudio> {
  const { bytes, fileName, mediaType } = input

  if (bytes.byteLength > PARSER_CONFIG.audio.maxBytes) {
    throw new AudioTooLargeError(
      bytes.byteLength,
      PARSER_CONFIG.audio.maxBytes,
    )
  }

  if (!isSupportedAudioType(mediaType, fileName)) {
    throw new UnsupportedAudioTypeError(mediaType)
  }

  const modelMediaType = resolveModelMediaType(mediaType, fileName)

  const { output: analysis } = await generateText({
    model: PARSER_CONFIG.audio.model,
    output: Output.object({ schema: audioAnalysisSchema }),
    system: `You are a precise audio parsing assistant. Transcribe the provided recording faithfully, diarise it by speaker, and extract structured metadata. Keep speaker labels stable across segments. Do not invent content that is not present in the audio.

${MENTIONED_PEOPLE_PROMPT}

For audio specifically: the 'author/sender' is each of the SPEAKERS — don't include them in mentionedPeople. Only emit third parties referenced by the speakers (e.g. "John from Acme said yesterday…" → John). When inferring organization from a speaker's affiliation, only do so if the audio itself makes the speaker's company unambiguous (someone introduces themselves with affiliation, or a recipient addresses them by company).`,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Filename: ${fileName}\n\nTranscribe the attached audio into speaker-separated segments with accurate timestamps, and extract the structured metadata per the schema. If speakers can be identified by name from the audio itself, use those names as labels; otherwise use 'Speaker 1', 'Speaker 2', etc. — keep a label consistent for the same voice across segments.`,
          },
          {
            type: "file",
            mediaType: modelMediaType,
            data: bytes,
            filename: fileName,
          },
        ],
      },
    ],
  })

  // Clean speaker labels + segments server-side so frontmatter and the
  // rendered transcript stay consistent if the model returned slight
  // variations (e.g. "Speaker 1" in segments, "speaker 1" in speakers list).
  const segments = analysis.segments.map((s) => ({
    ...s,
    speaker: s.speaker.trim() || "Unknown",
    transcript: s.transcript.trim(),
  }))
  const speakers = uniqueStrings(
    segments.length > 0 ? segments.map((s) => s.speaker) : analysis.speakers,
  )

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
    // Speakers are the "authors" of the recording's content.
    senders: speakers,
    // Recipients don't apply to recordings in general — leave empty unless
    // a future caller has context (e.g. voicemail target).
    recipients: [],
    mentions: uniqueStrings(analysis.mentions),
    companies: uniqueStrings(analysis.companies),
    products: uniqueStrings(analysis.products),
    urls: uniqueStrings(analysis.urls),
  }

  const contentMarkdown = renderTranscript({
    durationSeconds: analysis.durationSeconds,
    segments,
  })

  // Plain-text transcript for callers that want the spoken words as a message
  // body. Speaker-prefixed only when diarisation found more than one voice.
  const transcript = segments
    .filter((s) => s.transcript)
    .map((s) => (speakers.length > 1 ? `${s.speaker}: ${s.transcript}` : s.transcript))
    .join("\n")
    .trim()

  const markdown = assembleMarkdown(
    buildFrontmatter(frontmatterFields),
    analysis.summary,
    contentMarkdown,
  )

  return {
    markdown,
    transcript,
    metadata: {
      sourceId: input.sourceId,
      sourceSystem: input.sourceSystem,
      fileName,
      mediaType,
      byteSize: bytes.byteLength,
      durationSeconds: analysis.durationSeconds,
      speakerCount: speakers.length,
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

export type TranscriptSegment = {
  startSeconds: number
  durationSeconds: number
  speaker: string
  transcript: string
}

export function renderTranscript(args: {
  durationSeconds: number
  segments: TranscriptSegment[]
}): string {
  const { durationSeconds, segments } = args
  const lines: string[] = []
  lines.push(
    `**Total duration:** ${formatTimestamp(durationSeconds)} · **Speakers:** ${uniqueStrings(segments.map((s) => s.speaker)).length}`,
  )
  lines.push("")

  if (segments.length === 0) {
    lines.push("_(no speech detected)_")
    return lines.join("\n")
  }

  for (const s of segments) {
    lines.push(
      `**${formatTimestamp(s.startSeconds)}** · *${formatDuration(s.durationSeconds)}* · **${s.speaker}**`,
    )
    lines.push("")
    lines.push(s.transcript)
    lines.push("")
  }
  return lines.join("\n").trim()
}

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }
  return `${m}:${String(sec).padStart(2, "0")}`
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (rem === 0) return `${m}m`
  return `${m}m ${rem}s`
}

export function isSupportedAudioType(
  mediaType: string,
  fileName: string,
): boolean {
  if (PARSER_CONFIG.audio.supportedMediaTypes.includes(mediaType.toLowerCase()))
    return true
  const lower = fileName.toLowerCase()
  return PARSER_CONFIG.audio.supportedExtensions.some((ext) =>
    lower.endsWith(ext),
  )
}

/**
 * Pick the mime type we hand to Gemini in the file part. The caller-supplied
 * `mediaType` is whatever the source system reported (Nylas attachment header,
 * Google Chat `contentType`, browser `File.type`, …) and may be missing or
 * use a non-standard spelling. Gemini accepts `audio/mpeg` for mp3 and
 * `audio/mp4` for m4a — normalise everything else to one of those so we
 * don't get rejected on `audio/x-m4a` or an empty `application/octet-stream`.
 */
function resolveModelMediaType(mediaType: string, fileName: string): string {
  const mt = (mediaType || "").toLowerCase()
  const fn = fileName.toLowerCase()

  // m4a / aac variants → audio/mp4 (the canonical mime for an MP4 audio
  // container, which is what Google Chat voice messages and Apple Voice
  // Memos produce).
  if (mt === "audio/x-m4a" || mt === "audio/m4a" || mt === "audio/aac") {
    return "audio/mp4"
  }
  if (
    fn.endsWith(".m4a") &&
    (!mt || mt === "application/octet-stream" || mt === "audio/mp4")
  ) {
    return "audio/mp4"
  }
  if (
    fn.endsWith(".aac") &&
    (!mt || mt === "application/octet-stream")
  ) {
    return "audio/mp4"
  }

  // mp3 variants → audio/mpeg (Gemini's documented spelling).
  if (mt === "audio/mp3") return "audio/mpeg"
  if (
    fn.endsWith(".mp3") &&
    (!mt || mt === "application/octet-stream")
  ) {
    return "audio/mpeg"
  }

  // ogg / opus variants → audio/ogg (Gemini's documented spelling). Telegram
  // bot voice messages are Opus-in-Ogg and report `audio/ogg`, but some
  // clients spell it `audio/opus` or send a bare extension.
  if (mt === "audio/opus" || mt === "audio/ogg") return "audio/ogg"
  if (
    (fn.endsWith(".ogg") || fn.endsWith(".oga")) &&
    (!mt || mt === "application/octet-stream")
  ) {
    return "audio/ogg"
  }

  return mediaType
}

export class AudioTooLargeError extends Error {
  constructor(
    public actual: number,
    public max: number,
  ) {
    super(
      `Audio is ${formatBytes(actual)} which exceeds the ${formatBytes(max)} cap`,
    )
    this.name = "AudioTooLargeError"
  }
}

export class UnsupportedAudioTypeError extends Error {
  constructor(public mediaType: string) {
    super(`Unsupported audio media type: ${mediaType}`)
    this.name = "UnsupportedAudioTypeError"
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
