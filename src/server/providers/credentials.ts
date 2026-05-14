// Per-provider credentials accessors. Single point of truth for:
//   - decrypting `source.credentials_ref`
//   - validating decoded payloads against the provider's zod schema
//   - per-provider env-fallback policy (see notes per fn)
//   - actionable errors when credentials are missing
//
// Every handler / sync / parse path that previously read `process.env`
// for credentials now goes through here. The migration script populates
// `credentials_ref` for every existing row; after that, env reads
// happen only in the documented fallback paths.
//
// Accessor signature is `(sourceId, credentialsRef)` — two positional
// args, no struct — to avoid field-name overlap with the sync /
// parse contexts (which sometimes call the source row's id `id` and
// sometimes `sourceId`). Callers pass the source row's id explicitly.

import "server-only"

import { decryptCredentials } from "@/lib/credentials-crypto"
import {
  type GchatCredentials,
  type GdriveCredentials,
  type NylasCredentials,
  gchatCredentialsSchema,
  gdriveCredentialsSchema,
  nylasCredentialsSchema,
} from "@/server/providers/handlers"

export class MissingCredentialsError extends Error {
  constructor(public sourceId: string, public provider: string) {
    super(
      `Source ${sourceId} (${provider}) has no credentials configured. ` +
        `Open Sources → "Manage organization sources" → Configure to set them.`,
    )
    this.name = "MissingCredentialsError"
  }
}

export class InvalidCredentialsError extends Error {
  constructor(
    public sourceId: string,
    public provider: string,
    public reason: string,
  ) {
    super(
      `Source ${sourceId} (${provider}) has malformed credentials: ${reason}`,
    )
    this.name = "InvalidCredentialsError"
  }
}

// Internal: decrypt + zod-validate. Throws on missing/malformed.
function decryptAndValidate<T>(
  sourceId: string,
  credentialsRef: string | null,
  provider: string,
  schema: { parse: (input: unknown) => T },
): T {
  if (!credentialsRef) {
    throw new MissingCredentialsError(sourceId, provider)
  }
  let decoded: unknown
  try {
    decoded = decryptCredentials(credentialsRef)
  } catch (err) {
    throw new InvalidCredentialsError(
      sourceId,
      provider,
      err instanceof Error ? err.message : String(err),
    )
  }
  try {
    return schema.parse(decoded)
  } catch (err) {
    throw new InvalidCredentialsError(
      sourceId,
      provider,
      err instanceof Error ? err.message : String(err),
    )
  }
}

// ── Nylas ────────────────────────────────────────────────────────────
//
// Per-source secret: `grantId` (which mailbox to read).
// Env fallback: `NYLAS_GRANT_ID` — kept because some bootstrap flows
// may run before the migration. Logs a warning when fallback fires so
// drift in production is visible.
export function getNylasCredentials(
  sourceId: string,
  credentialsRef: string | null,
): NylasCredentials {
  if (credentialsRef) {
    return decryptAndValidate(
      sourceId,
      credentialsRef,
      "nylas",
      nylasCredentialsSchema,
    )
  }
  const envGrantId = process.env.NYLAS_GRANT_ID
  if (!envGrantId) {
    throw new MissingCredentialsError(sourceId, "nylas")
  }
  console.warn(
    `[credentials] nylas source ${sourceId} has no credentials_ref — falling back to NYLAS_GRANT_ID env. Run migrate-credentials-to-db to seed the row.`,
  )
  return { grantId: envGrantId }
}

// ── Google Chat ──────────────────────────────────────────────────────
//
// Per-source secret: `serviceAccountJson` + `impersonateUser`.
// NO env fallback after migration — the migration script seeds every
// existing row, and Phase 3's whole point is per-org isolation.
// Throws if `credentialsRef` is null.
export function getGchatCredentials(
  sourceId: string,
  credentialsRef: string | null,
): GchatCredentials {
  return decryptAndValidate(
    sourceId,
    credentialsRef,
    "gchat",
    gchatCredentialsSchema,
  )
}

// ── Google Drive ─────────────────────────────────────────────────────
//
// Per-source secret: `serviceAccountJson`.
// NO env fallback (same rationale as gchat).
export function getGdriveCredentials(
  sourceId: string,
  credentialsRef: string | null,
): GdriveCredentials {
  return decryptAndValidate(
    sourceId,
    credentialsRef,
    "gdrive",
    gdriveCredentialsSchema,
  )
}
