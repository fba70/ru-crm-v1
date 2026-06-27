// Centralised tuning for source parsers. Values here are expected to move
// into a DB-backed settings dictionary once the schema is in place — for now
// this module is the single source of truth.

export const PARSER_CONFIG = {
  text: {
    // Email body + metadata extraction.
    model: "google/gemini-2.5-flash",
  },
  pdf: {
    // Hard size cap — oversize files are skipped with a reason rather than
    // silently dropped. 20 MB handles most slide decks and contracts; scanned
    // 500-page PDFs should be pre-filtered by the caller anyway.
    maxBytes: 20 * 1024 * 1024,
    model: "google/gemini-2.5-flash",
  },
  image: {
    // 5 MB is enough for screenshots, photos from phones, and most scans.
    // Oversize images are usually either compressible losslessly or TIFFs
    // that should go through a dedicated scan pipeline later.
    maxBytes: 5 * 1024 * 1024,
    model: "google/gemini-2.5-flash",
    // Supported IANA media types. Everything else is reported as skipped.
    supportedMediaTypes: ["image/jpeg", "image/png"] as readonly string[],
    // File-extension fallback when a provider hands us an unknown content
    // type (some Nylas/Chat responses report application/octet-stream).
    supportedExtensions: [".jpg", ".jpeg", ".png"] as readonly string[],
    // Decorative-inline-image triage (see `src/lib/image-triage.ts`). Applied
    // ONLY to inline (cid:) email images — the logos / signature graphics /
    // social badges / header-footer banners / tracking pixels that pollute
    // source items with no real content. Explicit attachments bypass this.
    // Skipped images are still recorded as audit rows (parse_error = reason),
    // just excluded from parsed content + discovery, and cost no LLM call.
    decorative: {
      trackingPixelMax: 3, // ≤3px on either axis → tracking pixel / spacer
      iconMaxDimension: 200, // ≤200px on BOTH axes → logo / icon / badge
      bannerShortSideMax: 120, // thin strip: short side ≤120px …
      bannerAspectRatio: 4.5, // … and long/short ≥4.5 → header/footer banner
    },
  },
  audio: {
    // 10 MB ≈ 10–15 min of 128 kbps mp3 — comfortable for voice memos and
    // short meeting clips. Longer recordings should be split upstream or go
    // through a dedicated long-form pipeline later.
    maxBytes: 10 * 1024 * 1024,
    // Flash handles transcription + diarization + structured extraction in
    // one call. Swap to `google/gemini-2.5-pro` here if diarization quality
    // falls short on a specific dataset.
    model: "google/gemini-2.5-flash",
    // m4a (AAC inside an MP4 container) is what Google Chat voice messages
    // and Apple Voice Memos produce — accept its various reported mime
    // spellings here. `audio.ts` normalises them to `audio/mp4` before the
    // Gemini call. OGG/Opus is what Telegram bot voice messages
    // (`message.voice`) arrive as — Gemini accepts `audio/ogg` natively, so
    // `audio.ts` normalises the `audio/opus` spelling to it.
    supportedMediaTypes: [
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/x-m4a",
      "audio/m4a",
      "audio/aac",
      "audio/ogg",
      "audio/opus",
    ] as readonly string[],
    supportedExtensions: [".mp3", ".m4a", ".aac", ".ogg", ".oga"] as readonly string[],
  },
  video: {
    // 50 MB handles typical short clips (screen recordings, meeting
    // snippets, phone videos up to a few minutes). Longer recordings should
    // either be trimmed upstream or go through a chunked pipeline later.
    maxBytes: 50 * 1024 * 1024,
    // Flash handles visual summarisation + diarised transcription in one
    // call. Pro is worth trying if scene understanding is weak on a
    // specific dataset — swap here.
    model: "google/gemini-2.5-flash",
    supportedMediaTypes: ["video/mp4"] as readonly string[],
    supportedExtensions: [".mp4"] as readonly string[],
  },
  office: {
    // Covers both .docx and .pptx — extracted server-side via mammoth
    // (docx) and a custom jszip+xmldom pptx extractor, then the extracted
    // text/HTML is passed to Gemini for markdown cleanup + metadata.
    // Legacy .doc / .ppt are intentionally unsupported.
    maxBytes: 20 * 1024 * 1024,
    model: "google/gemini-2.5-flash",
    supportedMediaTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ] as readonly string[],
    supportedExtensions: [".docx", ".pptx"] as readonly string[],
  },
} as const
