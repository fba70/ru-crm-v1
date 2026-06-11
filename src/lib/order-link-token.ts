import "server-only"

import { randomBytes, createHash } from "crypto"

// Guest order-link token helpers. The raw token is high-entropy random
// (256-bit CSPRNG), so a fast hash (SHA-256) is the correct choice for the
// stored lookup key — not a slow KDF (spec §7 / FR-1). The raw token is
// returned to the caller exactly once and never persisted.

/** 32 random bytes, URL-safe base64 (no padding). */
export function generateRawToken(): string {
  return randomBytes(32).toString("base64url")
}

/** sha256(rawToken) as lowercase hex — the value stored + indexed. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

/** Public guest URL for a raw token. Token is the only thing in the path. */
export function buildOrderLinkUrl(rawToken: string): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    ""
  ).replace(/\/$/, "")
  return `${base}/o/${rawToken}`
}
