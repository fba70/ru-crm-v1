import "server-only"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/**
 * AES-256-GCM symmetric encryption for `source.credentials_ref`.
 *
 * Key: `CREDENTIALS_ENCRYPTION_KEY` env var, base64-encoded 32 bytes.
 * Generate one with `openssl rand -base64 32`. Store it as a Vercel encrypted
 * env var (and in `.env.local` for dev) — losing the key permanently bricks
 * every encrypted credential blob in the DB.
 *
 * ── Wire format ───────────────────────────────────────────────────────
 *
 * v1 (current writer):  base64( 0x01 | iv(12) | tag(16) | ciphertext )
 * v0 (legacy reader):   base64( iv(12) | tag(16) | ciphertext )
 *
 * The 1-byte version prefix is the foundation for future key rotation:
 * adding `0x02` later means a new key id can coexist with v1, and the
 * decoder dispatches by byte. Today only one key exists, so encryption
 * is always v1.
 *
 * Reader dispatches: first byte 0x01 → v1, anything else → v0. There's
 * a 1/256 chance a legacy v0 blob's IV starts with 0x01 and the v1
 * reader is invoked by mistake — this surfaces as a loud GCM auth-tag
 * decryption failure (not silent corruption), which the operator
 * resolves by re-saving the affected row through the credentials form.
 *
 * ── Future rotation (v2+) ─────────────────────────────────────────────
 *
 * 1. Add `CREDENTIALS_ENCRYPTION_KEY_V2` env var with the new key.
 * 2. Bump VERSION_WRITE to 0x02 and add `decryptV2()` next to v1's reader.
 * 3. The decoder already dispatches by byte → no API change for callers.
 * 4. Lazy migration: on next save, the row gets re-encrypted under v2.
 *    Active migration: a one-shot script reads + re-writes every row.
 */

const VERSION_V1 = 0x01
const VERSION_WRITE = VERSION_V1
const IV_BYTES = 12
const TAG_BYTES = 16

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY env var is required (base64 of 32 random bytes — `openssl rand -base64 32`)",
    )
  }
  const buf = Buffer.from(raw, "base64")
  if (buf.byteLength !== 32) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes; got ${buf.byteLength}`,
    )
  }
  cachedKey = buf
  return buf
}

export function encryptCredentials(plain: unknown): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv)
  const data = Buffer.from(JSON.stringify(plain), "utf8")
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([
    Buffer.from([VERSION_WRITE]),
    iv,
    tag,
    ciphertext,
  ]).toString("base64")
}

export function decryptCredentials<T = unknown>(packed: string): T {
  const buf = Buffer.from(packed, "base64")
  if (buf.byteLength < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("Encrypted credentials blob is malformed (too short)")
  }

  if (buf[0] === VERSION_V1) {
    return decryptV1<T>(buf)
  }
  // No recognised version prefix — treat as v0 legacy. Operators with
  // legacy rows will hit this path until they re-save the row through
  // the credentials form, at which point it gets re-encrypted under v1.
  return decryptV0<T>(buf)
}

function decryptV1<T>(buf: Buffer): T {
  // Layout: [ 0x01 | iv | tag | ciphertext ]
  if (buf.byteLength < 1 + IV_BYTES + TAG_BYTES + 1) {
    throw new Error("Encrypted credentials blob is malformed (v1 too short)")
  }
  const iv = buf.subarray(1, 1 + IV_BYTES)
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const ciphertext = buf.subarray(1 + IV_BYTES + TAG_BYTES)
  return runDecipher<T>(iv, tag, ciphertext)
}

function decryptV0<T>(buf: Buffer): T {
  // Layout: [ iv | tag | ciphertext ]
  if (buf.byteLength < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("Encrypted credentials blob is malformed (v0 too short)")
  }
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES)
  return runDecipher<T>(iv, tag, ciphertext)
}

function runDecipher<T>(iv: Buffer, tag: Buffer, ciphertext: Buffer): T {
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plain.toString("utf8")) as T
}
