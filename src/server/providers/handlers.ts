// Server-only handler bundle per provider — paired with the metadata
// registry in `src/lib/sources/providers.ts`. Every server consumer
// that used to switch on `source.provider` should look up the handler
// here instead. Adding a new provider:
//   1. Append the enum value in `src/db/schema.ts`
//   2. Add a metadata entry in `src/lib/sources/providers.ts`
//   3. Add a handler entry below
// The `Record<SourceProvider, ProviderHandler>` typing makes step 3
// compile-required as soon as step 1 lands.
//
// `credentialsSchema` describes what the decrypted `source.credentials_ref`
// blob should hold for each provider. The schema is the contract used by:
//   - `src/server/providers/credentials.ts` to validate after decrypt
//   - the credentials form UI to render the right inputs
//   - the migration script to write the right env values into each row

import "server-only"

import { z } from "zod"
import type { SourceProvider } from "@/db/schema"
import type { SyncResult } from "@/server/sync/_shared"
import { syncNylasEmails } from "@/server/sync/nylas"
import { syncGoogleChatMessages } from "@/server/sync/gchat"
import { syncGoogleDriveFiles } from "@/server/sync/gdrive"
import {
  isNylasItemMissing,
  isGoogleChatItemMissing,
  isGoogleDriveItemMissing,
} from "@/server/parsers/_provider-errors"

// ── Per-provider credential payload schemas ──────────────────────────
//
// Nylas: only the per-mailbox grant id moves to credentials_ref. The
// platform-level NYLAS_API_KEY / NYLAS_API_URI stay in env forever
// (they identify Truffalo to Nylas, not any specific org's mailbox).
export const nylasCredentialsSchema = z.object({
  grantId: z.string().min(1, "grantId is required"),
})
export type NylasCredentials = z.infer<typeof nylasCredentialsSchema>

// Google Chat: per-org service account JSON (for DWD impersonation) plus
// the Workspace user to impersonate. Pasted as raw JSON so the form can
// validate parseability before save.
export const gchatCredentialsSchema = z.object({
  serviceAccountJson: z
    .string()
    .min(1, "Service account JSON is required")
    .refine((s) => {
      try {
        const parsed = JSON.parse(s)
        return (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof parsed.client_email === "string" &&
          typeof parsed.private_key === "string"
        )
      } catch {
        return false
      }
    }, "Service account JSON must parse and contain client_email + private_key"),
  impersonateUser: z
    .string()
    .email("impersonateUser must be a Workspace email address"),
})
export type GchatCredentials = z.infer<typeof gchatCredentialsSchema>

// Google Drive: per-org service account JSON. No impersonation today
// (Drive API endpoints we use accept app-auth scopes); kept symmetrical
// with gchat in case shared-drive access ever needs DWD too.
export const gdriveCredentialsSchema = z.object({
  serviceAccountJson: z
    .string()
    .min(1, "Service account JSON is required")
    .refine((s) => {
      try {
        const parsed = JSON.parse(s)
        return (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof parsed.client_email === "string" &&
          typeof parsed.private_key === "string"
        )
      } catch {
        return false
      }
    }, "Service account JSON must parse and contain client_email + private_key"),
})
export type GdriveCredentials = z.infer<typeof gdriveCredentialsSchema>

// Union over all per-provider credential schemas. `null` for providers
// that never need credentials (dropoff / whatsapp / aichat).
export type ProviderCredentialsSchema = z.ZodType | null

// ── Per-provider non-secret connection config schemas ────────────────
//
// Lives next to credentialsSchema so a single registry edit covers
// both surfaces. Schema-driven forms (`<FormSourceProviderConfig>`)
// render fields from this schema; sync handlers parse against it
// before reading individual fields. `null` for providers with no
// configurable routing (dropoff/whatsapp/aichat). Empty object
// (`z.object({})`) for providers where every previous config field
// has moved to credentials_ref (nylas) — kept non-null so the form
// can still render an empty state with a "no fields configurable"
// message instead of being hidden entirely.

export const nylasProviderConfigSchema = z.object({})
export type NylasProviderConfig = z.infer<typeof nylasProviderConfigSchema>

export const gchatProviderConfigSchema = z.object({
  spaceId: z
    .string()
    .regex(/^spaces\//, "spaceId must start with 'spaces/'"),
})
export type GchatProviderConfig = z.infer<typeof gchatProviderConfigSchema>

export const gdriveProviderConfigSchema = z.object({
  driveId: z.string().min(1, "driveId is required"),
})
export type GdriveProviderConfig = z.infer<typeof gdriveProviderConfigSchema>

export type ProviderConfigSchema = z.ZodType | null

export type ProviderHandler = {
  // Remote sync entry point. Null when the provider has no provider-side
  // fetch (dropoff, whatsapp, aichat — items arrive via upload routes
  // or are written directly at save time). The dispatcher in
  // `src/server/sync/index.ts` rejects sourceIds whose provider has a
  // null `sync` so the caller gets a clear error rather than a no-op.
  sync: ((sourceId: string) => Promise<SyncResult>) | null
  // Parse-time "this item no longer exists at the provider" detector,
  // used by `parseSourceItem` to mark the row `'skipped'` instead of
  // `'failed'`. Null for providers where items can't disappear (dropoff,
  // whatsapp, aichat — bytes are local or the row is born complete).
  isItemMissing: ((err: unknown) => boolean) | null
  // Zod schema describing the decrypted credentials payload for this
  // provider. Null when no per-source credentials are needed.
  credentialsSchema: ProviderCredentialsSchema
  // Zod schema describing the non-secret `provider_config` payload.
  // Null when the provider has no configurable connection routing.
  providerConfigSchema: ProviderConfigSchema
}

export const HANDLERS: Record<SourceProvider, ProviderHandler> = {
  nylas: {
    sync: syncNylasEmails,
    isItemMissing: isNylasItemMissing,
    credentialsSchema: nylasCredentialsSchema,
    providerConfigSchema: nylasProviderConfigSchema,
  },
  gchat: {
    sync: syncGoogleChatMessages,
    isItemMissing: isGoogleChatItemMissing,
    credentialsSchema: gchatCredentialsSchema,
    providerConfigSchema: gchatProviderConfigSchema,
  },
  gdrive: {
    sync: syncGoogleDriveFiles,
    isItemMissing: isGoogleDriveItemMissing,
    credentialsSchema: gdriveCredentialsSchema,
    providerConfigSchema: gdriveProviderConfigSchema,
  },
  dropoff: {
    sync: null,
    isItemMissing: null,
    credentialsSchema: null,
    providerConfigSchema: null,
  },
  whatsapp: {
    sync: null,
    isItemMissing: null,
    credentialsSchema: null,
    providerConfigSchema: null,
  },
  aichat: {
    sync: null,
    isItemMissing: null,
    credentialsSchema: null,
    providerConfigSchema: null,
  },
}

export function getHandler(provider: SourceProvider): ProviderHandler {
  return HANDLERS[provider]
}
