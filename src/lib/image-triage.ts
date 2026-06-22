// Cheap, dependency-free triage for inline email images.
//
// Email bodies are full of decorative chrome — company logos, signature
// graphics, social-media badges, header/footer banners, divider rules and
// 1×1 tracking pixels. Each of those, if handed to the image parser, becomes
// a low-value `inline_image` source item (and an LLM bill). This module lets
// the parser drop the obvious junk BEFORE the model call, using only the
// image's own header bytes (pixel dimensions) plus filename hints.
//
// Pure + no `server-only` so it can be unit-tested and imported from the
// tsx CLI. The actual skip/keep decision and DB write live in the caller
// (`parse-source-item.ts`).

export type ImageSize = { width: number; height: number }

/**
 * Read the intrinsic pixel dimensions from an image's header bytes without
 * decoding the pixels. Supports the formats that actually show up inline in
 * email HTML: PNG, JPEG, GIF, WebP, BMP. Returns null for anything it can't
 * confidently size (caller then falls back to filename + LLM signals).
 */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null

  // PNG — 8-byte signature, then IHDR with width/height as big-endian u32.
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = readU32BE(bytes, 16)
    const height = readU32BE(bytes, 20)
    if (width > 0 && height > 0) return { width, height }
    return null
  }

  // GIF — "GIF87a"/"GIF89a", logical screen width/height as little-endian u16.
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const width = bytes[6] | (bytes[7] << 8)
    const height = bytes[8] | (bytes[9] << 8)
    if (width > 0 && height > 0) return { width, height }
    return null
  }

  // BMP — "BM", then DIB header with width/height as little-endian i32 at 18/22.
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const width = readU32LE(bytes, 18)
    const height = readU32LE(bytes, 22)
    if (width > 0 && height > 0) return { width, height }
    return null
  }

  // WebP — "RIFF"…"WEBP", then a VP8 / VP8L / VP8X chunk.
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return readWebpSize(bytes)
  }

  // JPEG — scan the marker segments for a Start-Of-Frame (SOF0–SOF3, etc.).
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return readJpegSize(bytes)
  }

  return null
}

function readU32BE(b: Uint8Array, o: number): number {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]
}
function readU32LE(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

function readWebpSize(b: Uint8Array): ImageSize | null {
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15])
  if (fourcc === "VP8 ") {
    // Lossy: dimensions are 14 bits each at offset 26/28 (little-endian).
    const width = (b[26] | (b[27] << 8)) & 0x3fff
    const height = (b[28] | (b[29] << 8)) & 0x3fff
    return width > 0 && height > 0 ? { width, height } : null
  }
  if (fourcc === "VP8L") {
    // Lossless: 14-bit width/height minus one, packed from offset 21.
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return width > 0 && height > 0 ? { width, height } : null
  }
  if (fourcc === "VP8X") {
    // Extended: 24-bit canvas width/height minus one at offset 24/27.
    const width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1
    const height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1
    return width > 0 && height > 0 ? { width, height } : null
  }
  return null
}

function readJpegSize(b: Uint8Array): ImageSize | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++
      continue
    }
    const marker = b[i + 1]
    // SOF0..SOF15 carry the frame dimensions, excluding the non-frame
    // markers SOF4 (0xc4 DHT), SOF8 (0xc8 JPG), SOF12 (0xcc DAC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      const height = (b[i + 5] << 8) | b[i + 6]
      const width = (b[i + 7] << 8) | b[i + 8]
      return width > 0 && height > 0 ? { width, height } : null
    }
    // Standalone markers (RSTn, SOI, EOI, TEM) have no length field.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const segLen = (b[i + 2] << 8) | b[i + 3]
    if (segLen < 2) return null
    i += 2 + segLen
  }
  return null
}

// Filenames the mail client gives inline chrome. Conservative — only matches
// whole-word-ish decorative hints so a "screenshot-logoff.png" isn't caught.
const DECORATIVE_NAME = /\b(logo|banner|spacer|pixel|tracking|footer|header|divider|separator|signature|sig|icon|badge|facebook|twitter|linkedin|instagram|youtube|whatsapp|telegram|social)\b/i

export type DecorativeThresholds = {
  /** ≤ this on EITHER axis → tracking pixel / spacer. */
  trackingPixelMax: number
  /** ≤ this on BOTH axes → logo / icon / social badge. */
  iconMaxDimension: number
  /** A thin strip — short side ≤ shortSide AND long/short ≥ aspectRatio. */
  bannerShortSideMax: number
  bannerAspectRatio: number
}

export type TriageResult = { skip: true; reason: string } | { skip: false }

/**
 * Decide whether an inline email image is decorative chrome that shouldn't
 * become a parsed source item. Dimension-based (when the header is readable)
 * plus a filename fallback. Never skips on size when dimensions are unknown —
 * that case defers to the LLM `isBoilerplate` judgment downstream.
 */
export function triageInlineImage(
  input: { bytes: Uint8Array; fileName: string },
  cfg: DecorativeThresholds,
): TriageResult {
  const size = readImageSize(input.bytes)
  if (size) {
    const { width, height } = size
    const short = Math.min(width, height)
    const long = Math.max(width, height)

    if (short <= cfg.trackingPixelMax) {
      return { skip: true, reason: `tracking pixel (${width}×${height})` }
    }
    if (width <= cfg.iconMaxDimension && height <= cfg.iconMaxDimension) {
      return { skip: true, reason: `decorative image (${width}×${height} logo/icon)` }
    }
    if (
      short <= cfg.bannerShortSideMax &&
      long / short >= cfg.bannerAspectRatio
    ) {
      return { skip: true, reason: `decorative banner (${width}×${height})` }
    }
  }

  const name = input.fileName || ""
  if (DECORATIVE_NAME.test(name)) {
    return { skip: true, reason: `decorative filename (${name})` }
  }

  return { skip: false }
}
