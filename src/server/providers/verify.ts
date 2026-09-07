// Save-time credentials probe.
//
// Zod validation only proves a payload is well-SHAPED. It cannot tell a
// real Nylas grant from a well-formed UUID that belongs to nobody, and it
// cannot tell a live API key from a revoked one. Both of those save
// cleanly and then fail on every sync — hours or days later, in a log the
// operator never reads, as an error message from the provider's SDK rather
// than from us.
//
// So every credentials write runs ONE cheap read-only call against the
// provider first and refuses the save when it fails. The operator learns
// about a bad value while the form is still open and the correct value is
// still on their clipboard.
//
// Design notes:
//   - Read-only. The probe must never mutate anything at the provider.
//   - Providers with no probe return silently, so adding one later is a
//     single `case` here and nothing else changes.
//   - Telegram is deliberately absent: saving its token already registers
//     the webhook (see `updateOwnerOrgSourceCredentials`), which is its own
//     verification with its own best-effort semantics.

import "server-only"

import type { SourceProvider } from "@/db/schema"
import { resolveNylasConnection } from "@/lib/nylas"
import type { NylasCredentials } from "@/server/providers/handlers"

// Thrown when the provider rejects a well-formed payload. Carries a
// message written for the operator staring at the credentials dialog, not
// for a log reader — the route surfaces it verbatim as a 400.
export class CredentialsVerificationError extends Error {
  constructor(
    public provider: SourceProvider,
    message: string,
  ) {
    super(message)
    this.name = "CredentialsVerificationError"
  }
}

// How long to wait on the provider before giving up. A save must not hang
// on a slow or unreachable API; a timeout is reported as "could not check",
// which is a different (and less alarming) message than "rejected".
const PROBE_TIMEOUT_MS = 10_000

// Pull the human-readable half out of a Nylas error envelope. Their API
// answers with `{ error: { type, message } }` for routed requests, but with
// PLAIN TEXT (`Cannot GET /v3/…`) when the path doesn't match a route at
// all — which is exactly what a malformed grant id produces. Reading the
// body as text first and only then trying JSON covers both without
// throwing a second, more confusing error.
function describeNylasFailure(status: number, body: string): string {
  let detail = body.trim().slice(0, 200)
  try {
    const parsed = JSON.parse(body)
    const msg = parsed?.error?.message ?? parsed?.message
    if (typeof msg === "string" && msg) detail = msg
  } catch {
    // Plain-text body — keep the truncated raw text as the detail.
  }

  if (status === 401 || status === 403) {
    return (
      `Nylas rejected the API key (${status}: ${detail}). ` +
      `Check that the key belongs to the Nylas application that owns this grant, ` +
      `and that the API URI matches that application's region (EU vs US).`
    )
  }
  if (status === 404) {
    return (
      `Nylas does not know this Grant ID under that API key (${status}: ${detail}). ` +
      `A grant only resolves inside the application that created it — ` +
      `check you copied the grant from the same Nylas application as the key.`
    )
  }
  return `Nylas rejected these credentials (${status}: ${detail}).`
}

// One read-only `GET /v3/grants/{id}`: the cheapest call that proves the
// key is live, the region is right, AND the grant resolves under that key.
// Listing messages would prove the same thing but costs a mailbox query.
async function verifyNylas(creds: NylasCredentials): Promise<void> {
  const { apiKey, apiUri } = resolveNylasConnection(creds)

  let res: Response
  try {
    res = await fetch(
      `${apiUri}/v3/grants/${encodeURIComponent(creds.grantId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    )
  } catch (err) {
    throw new CredentialsVerificationError(
      "nylas",
      `Could not reach Nylas at ${apiUri} to check these credentials ` +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        `Check the API URI and try again.`,
    )
  }

  if (!res.ok) {
    throw new CredentialsVerificationError(
      "nylas",
      describeNylasFailure(res.status, await res.text().catch(() => "")),
    )
  }

  // A grant can resolve and still be dead — the user revoked access at the
  // provider, or the OAuth token expired. Nylas reports that as
  // `grant_status`, not as an HTTP status, so a 200 alone is not enough.
  const data = (await res.json().catch(() => null)) as {
    data?: { grant_status?: string; email?: string }
  } | null
  const status = data?.data?.grant_status
  if (status && status !== "valid") {
    throw new CredentialsVerificationError(
      "nylas",
      `The Nylas grant resolves but its status is "${status}", not "valid". ` +
        `Reconnect the mailbox in the Nylas dashboard, then paste the grant again.`,
    )
  }
}

/**
 * Probe a validated credentials payload against its provider before it is
 * encrypted and written. Resolves on success (including for providers with
 * no probe); throws `CredentialsVerificationError` when the provider says
 * no.
 *
 * `credentials` must already have passed the provider's zod schema — this
 * checks whether well-formed values are actually LIVE, nothing else.
 */
export async function verifyProviderCredentials(
  provider: SourceProvider,
  credentials: unknown,
): Promise<void> {
  switch (provider) {
    case "nylas":
      return verifyNylas(credentials as NylasCredentials)
    default:
      // No probe for this provider (yet) — saving is unchanged.
      return
  }
}
