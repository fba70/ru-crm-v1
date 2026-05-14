import "server-only"
import type { MetadataAnalysis } from "@/server/parsers/_shared"
import { parsePdfBytes, PdfTooLargeError } from "@/server/parsers/pdf"
import {
  parseImageBytes,
  isSupportedImageType,
  ImageTooLargeError,
  UnsupportedImageTypeError,
} from "@/server/parsers/image"
import {
  parseAudioBytes,
  isSupportedAudioType,
  AudioTooLargeError,
  UnsupportedAudioTypeError,
} from "@/server/parsers/audio"
import {
  parseVideoBytes,
  isSupportedVideoType,
  VideoTooLargeError,
  UnsupportedVideoTypeError,
} from "@/server/parsers/video"
import {
  parseOfficeBytes,
  isSupportedOfficeType,
  detectOfficeFormat,
  OfficeTooLargeError,
  UnsupportedOfficeTypeError,
} from "@/server/parsers/office"

export type DropoffBlockKind =
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "video_audio"
  | "docx"
  | "pptx"

export type DropoffBlock = {
  kind: DropoffBlockKind
  sourceId: string
  markdown: string
  analysis: MetadataAnalysis
}

export type ParsedDropoffFile = {
  blocks: DropoffBlock[]
  fileName: string
  mediaType: string
  byteSize: number
  dropoffId: string
}

export type DropoffParseInput = {
  bytes: Uint8Array
  fileName: string
  mediaType: string
  /**
   * Opaque client-supplied identifier for the drop-off entry — used only
   * for source_id namespacing. Caller provides something stable within
   * the session (e.g. the `DropoffEntry.id` from the browser context).
   */
  dropoffId: string
  /** Optional batch description from the upload dialog. */
  description?: string
  /** Name of the user who uploaded the file. */
  userName?: string
  /** When the file was dropped (upload time). Falls back to now. */
  uploadedAt?: string
}

/**
 * Parse a locally dropped-off file. Unlike Drive files we have no
 * Google-native formats to handle — only the neutral media formats we
 * already support (PDF, image, audio, video, Word, PowerPoint). Anything
 * else throws `UnsupportedDropoffTypeError`.
 *
 * Drop-off files are standalone sources (no parent, no thread), so every
 * block gets `parent_source_id: null` and `thread_id: null`.
 */
export async function parseDropoffFile(
  input: DropoffParseInput,
): Promise<ParsedDropoffFile> {
  const { bytes, fileName, mediaType, dropoffId } = input

  const kind = detectKind(mediaType, fileName)
  if (!kind) throw new UnsupportedDropoffTypeError(mediaType || "unknown")

  const sourceId = `dropoff:${dropoffId}`
  const nowIso = new Date().toISOString()
  const sourceCreatedAt = input.uploadedAt ?? nowIso

  const commonInput = {
    sourceId,
    parentSourceId: null,
    sourceSystem: "Dropped File",
    threadId: null,
    sourceCreatedAt,
    sourceReceivedAt: sourceCreatedAt,
  }

  const blocks: DropoffBlock[] = []

  if (kind === "pdf") {
    const result = await parsePdfBytes({
      ...commonInput,
      bytes,
      fileName,
    })
    blocks.push({
      kind: "pdf",
      sourceId,
      markdown: result.markdown,
      analysis: result.analysis,
    })
  } else if (kind === "audio") {
    const result = await parseAudioBytes({
      ...commonInput,
      bytes,
      fileName,
      mediaType: resolveMediaType(mediaType, "audio/mpeg"),
    })
    blocks.push({
      kind: "audio",
      sourceId,
      markdown: result.markdown,
      analysis: result.analysis,
    })
  } else if (kind === "video") {
    const audioSourceId = `${sourceId}:audio`
    const result = await parseVideoBytes({
      bytes,
      fileName,
      mediaType: resolveMediaType(mediaType, "video/mp4"),
      sourceSystem: "Dropped File",
      threadId: null,
      sourceCreatedAt,
      sourceReceivedAt: sourceCreatedAt,
      videoSourceId: sourceId,
      videoParentSourceId: null,
      audioSourceId,
      audioParentSourceId: sourceId,
    })
    blocks.push({
      kind: "video",
      sourceId,
      markdown: result.videoMarkdown,
      analysis: result.videoAnalysis,
    })
    blocks.push({
      kind: "video_audio",
      sourceId: audioSourceId,
      markdown: result.audioMarkdown,
      analysis: result.audioAnalysis,
    })
  } else if (kind === "office") {
    const format = detectOfficeFormat(mediaType, fileName)
    if (!format) throw new UnsupportedDropoffTypeError(mediaType || "unknown")
    const result = await parseOfficeBytes({
      ...commonInput,
      bytes,
      fileName,
      mediaType: resolveMediaType(
        mediaType,
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    })
    blocks.push({
      kind: format,
      sourceId,
      markdown: result.markdown,
      analysis: result.analysis,
    })
  } else {
    // image
    const result = await parseImageBytes({
      ...commonInput,
      bytes,
      fileName,
      mediaType: resolveMediaType(mediaType, inferImageMediaType(fileName)),
    })
    blocks.push({
      kind: "image",
      sourceId,
      markdown: result.markdown,
      analysis: result.analysis,
    })
  }

  return {
    blocks,
    fileName,
    mediaType: mediaType || "application/octet-stream",
    byteSize: bytes.byteLength,
    dropoffId,
  }
}

function detectKind(
  mediaType: string,
  fileName: string,
): "pdf" | "image" | "audio" | "video" | "office" | null {
  const ct = (mediaType || "").toLowerCase()
  const fn = fileName.toLowerCase()
  if (ct === "application/pdf" || fn.endsWith(".pdf")) return "pdf"
  if (isSupportedVideoType(ct, fn)) return "video"
  if (isSupportedAudioType(ct, fn)) return "audio"
  if (isSupportedImageType(ct, fn)) return "image"
  if (isSupportedOfficeType(ct, fn)) return "office"
  return null
}

function resolveMediaType(contentType: string, fallback: string): string {
  return contentType && contentType !== "application/octet-stream"
    ? contentType
    : fallback
}

function inferImageMediaType(fileName: string): string {
  return fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"
}

export class UnsupportedDropoffTypeError extends Error {
  constructor(public mediaType: string) {
    super(`Unsupported drop-off file type: ${mediaType}`)
    this.name = "UnsupportedDropoffTypeError"
  }
}

// Re-export so the API route's classifier can catch every parser error.
export {
  PdfTooLargeError,
  ImageTooLargeError,
  UnsupportedImageTypeError,
  AudioTooLargeError,
  UnsupportedAudioTypeError,
  VideoTooLargeError,
  UnsupportedVideoTypeError,
  OfficeTooLargeError,
  UnsupportedOfficeTypeError,
}
