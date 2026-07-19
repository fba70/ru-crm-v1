import "server-only"

// Recognise "this item no longer exists at the provider" errors so the
// parse pipeline can mark a row as `'skipped'` instead of crashing the
// whole batch. Each classifier is intentionally permissive — false
// positives just label a transient as "deleted" which the user can
// re-parse, false negatives turn a real deletion into "Parse failed"
// (recoverable in a worse-UX way). Conservative classification on
// status code first, message-string heuristics as a fallback.

type AnyErr = {
  statusCode?: number
  status?: number
  code?: number | string
  message?: string
  errors?: Array<{ reason?: string; message?: string }>
} & Record<string, unknown>

function asAnyErr(err: unknown): AnyErr | null {
  if (!err || typeof err !== "object") return null
  return err as AnyErr
}

function statusCodeOf(err: AnyErr): number | null {
  if (typeof err.statusCode === "number") return err.statusCode
  if (typeof err.status === "number") return err.status
  if (typeof err.code === "number") return err.code
  // googleapis sometimes stringifies the code
  if (typeof err.code === "string") {
    const n = Number.parseInt(err.code, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

function messageOf(err: AnyErr): string {
  if (typeof err.message === "string") return err.message.toLowerCase()
  return ""
}

// ── Nylas ─────────────────────────────────────────────────────────────

export function isNylasItemMissing(err: unknown): boolean {
  const e = asAnyErr(err)
  if (!e) return false
  const code = statusCodeOf(e)
  if (code === 404 || code === 410) return true
  const msg = messageOf(e)
  if (msg.includes("not found") || msg.includes("does not exist")) return true
  // Nylas v8 wraps API errors in NylasApiError with `type` like 'provider_error'
  const type = typeof e.type === "string" ? e.type.toLowerCase() : ""
  if (type === "object_not_found") return true
  return false
}

// ── IMAP ──────────────────────────────────────────────────────────────

// Thrown by the IMAP parser when the message can't be fetched any more:
// the UID is gone from the mailbox, OR the mailbox's UIDVALIDITY changed
// since sync (which invalidates every stored UID — see the parser). The
// parse pipeline maps this to `parse_status='skipped'` rather than
// `'failed'`, so a since-deleted email isn't retried forever.
export class ImapMessageMissingError extends Error {
  constructor(reason: string) {
    super(`IMAP message no longer available: ${reason}`)
    this.name = "ImapMessageMissingError"
  }
}

export function isImapItemMissing(err: unknown): boolean {
  if (err instanceof ImapMessageMissingError) return true
  const e = asAnyErr(err)
  if (!e) return false
  // imapflow surfaces a server "no such message" as code NONEXISTENT.
  const code = typeof e.code === "string" ? e.code.toUpperCase() : ""
  if (code === "NONEXISTENT") return true
  const msg = messageOf(e)
  if (
    msg.includes("not found") ||
    msg.includes("does not exist") ||
    msg.includes("no such message")
  ) {
    return true
  }
  return false
}

// ── Google Chat ──────────────────────────────────────────────────────

export function isGoogleChatItemMissing(err: unknown): boolean {
  const e = asAnyErr(err)
  if (!e) return false
  const code = statusCodeOf(e)
  if (code === 404 || code === 410) return true
  // googleapis surfaces server reasons in errors[]
  if (Array.isArray(e.errors)) {
    for (const sub of e.errors) {
      const reason = (sub.reason ?? "").toLowerCase()
      if (reason === "notfound" || reason === "deleted") return true
    }
  }
  const msg = messageOf(e)
  if (msg.includes("not found") || msg.includes("requested entity was not found")) {
    return true
  }
  return false
}

// ── Google Drive ─────────────────────────────────────────────────────

export function isGoogleDriveItemMissing(err: unknown): boolean {
  // Drive uses the same error shape as the rest of googleapis — and the
  // common cases (deleted / trashed-without-trashed-flag / never existed)
  // all surface as 404. Reuse the gchat classifier.
  return isGoogleChatItemMissing(err)
}
