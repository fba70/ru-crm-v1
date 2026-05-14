import { google } from "googleapis"

/**
 * Returns a GoogleAuth client for the supplied service-account credentials.
 *
 * `serviceAccount`: the parsed Google service-account JSON object (the
 * one that contains `client_email` + `private_key`). Per-source after
 * Phase 3 — every Sources subsystem call site now resolves it via
 * `getGchatCredentials(source)` / `getGdriveCredentials(source)` from
 * `src/server/providers/credentials.ts`.
 *
 * Pass `subject` to impersonate a Workspace user via domain-wide
 * delegation — required for endpoints that only accept user-auth scopes
 * (e.g. Chat `media.download` which needs `chat.messages.readonly`).
 * DWD must be enabled for the service account and the requested scopes
 * authorised in the Workspace Admin Console.
 */
export function getGoogleAuth(
  serviceAccount: Record<string, unknown>,
  scopes: string[],
  subject?: string,
) {
  return new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes,
    ...(subject ? { clientOptions: { subject } } : {}),
  })
}

/**
 * Helper: parse the service-account JSON string from the credentials
 * payload (zod has already verified it parses + carries the required
 * fields, but we still get back a `string` so call sites need this).
 */
export function parseServiceAccountJson(
  json: string,
): Record<string, unknown> {
  return JSON.parse(json) as Record<string, unknown>
}
