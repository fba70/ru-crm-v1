// Provider registry — single source of truth for everything the UI and
// the cron filters need to know about a source provider WITHOUT pulling
// in server-only handler code (Nylas SDK, googleapis, drizzle, etc.).
//
// Server-side handler bundle lives in `src/server/providers/handlers.ts`
// and references back to this metadata for shared fields (defaultName,
// defaultProviderConfig, defaultAutomatedParsingIsAllowed).
//
// Adding a new provider:
//   1. Append the enum value in `src/db/schema.ts` (sourceProvider)
//   2. Add a metadata entry below
//   3. Add a handler entry in `src/server/providers/handlers.ts`
// The `Record<SourceProvider, ProviderMetadata>` type makes step 2
// compile-required as soon as step 1 lands.

import {
  Mail,
  Inbox,
  MessageSquare,
  HardDrive,
  Upload,
  MessageCircle,
  Bot,
  Send,
  type LucideIcon,
} from "lucide-react"
import type { SourceProvider } from "@/db/schema"

// Capability flags drive UI conditionals (action bar buttons, re-parse
// availability) and orchestration filters (which providers the daily
// cron sync iterates). Kept granular even where pairs currently move
// together — see app/CLAUDE.md § "Provider registry" for the rationale
// behind keeping `supportsRemoteSync` and `supportsAutomatedPipeline`
// separate.
export type ProviderCapabilities = {
  // True when the provider has a remote API we can pull items from
  // (drives `<SyncActionBar>` per-source Sync buttons + the orchestration
  // `runFullSync()` iteration filter).
  supportsRemoteSync: boolean
  // True when items arrive via a folder/zip upload route (whatsapp).
  supportsArchiveUpload: boolean
  // True when items arrive via the ad-hoc file dropoff dialog.
  supportsDropoffUpload: boolean
  // True when raw bytes are persisted somewhere we can re-fetch from.
  // Drives `<RowActions>` Re-parse availability. False for dropoff
  // (bytes discarded after parse) and aichat (created from in-memory
  // chat state at save-time).
  hasRawBytesPersisted: boolean
  // True when the daily cron should sync/parse/upload items for this
  // provider. Distinct from `supportsRemoteSync` because an internal
  // provider could in principle be auto-parsed without remote sync —
  // currently aichat is the only internal provider and it's off, but
  // the flag stays separate so the distinction is explicit.
  supportsAutomatedPipeline: boolean
  // True when the provider exposes an on-demand manual PULL (distinct from
  // `supportsRemoteSync`, which also drives the cron). Telegram is push
  // (webhook) in production but offers a manual `getUpdates` pull — surfaced
  // as a per-source "Fetch" button on the Sources page, mainly for local
  // dev where the webhook can't reach the machine. Kept OFF the cron.
  supportsManualFetch: boolean
}

export type ProviderMetadata = {
  provider: SourceProvider
  // Short label shown in tables, filter dropdowns, and chat hit cards.
  label: string
  // One-line description used when the registry seeds a new per-org
  // source row (Phase 2). Also surfaced in admin-edit-source forms.
  description: string
  // Lucide icon component. Imported directly so consumers can render
  // <Icon className="…" /> without an indirection. Tree-shaking keeps
  // unused icons out of bundles that only need the metadata.
  icon: LucideIcon
  // Default name used when seeding a per-org source row. The org-owner
  // can rename after the fact — this is just the initial label.
  defaultName: string
  // Provider-specific connection config defaults. Per-source overrides
  // get merged on top in the seed flow.
  defaultProviderConfig: Record<string, unknown>
  // Initial value of `source.automated_parsing_is_allowed` when a new
  // row is seeded. Off for providers that ingest user-uploaded bytes
  // (no remote source for the cron to fetch) and for aichat (sessions
  // arrive pre-parsed at save-time, nothing for the pipeline to do).
  defaultAutomatedParsingIsAllowed: boolean
  // The `metadata_json` field holding the AUTHOR/sender side, read at parse
  // time by org-attribution (`extractAuthorEmails`) — see refs/org-attribution.md.
  // MUST point at the sender field only (directionality): `from` for email
  // (envelope sender), `participants` for gchat/gdrive (message sender / file
  // owner). `null` for providers with no author side (dropoff / whatsapp /
  // aichat / telegram) → no author emails → classified by content, so a member
  // dropping a client's file is correctly NOT us.
  authorEmailField: string | null
  capabilities: ProviderCapabilities
}

export const PROVIDERS: Record<SourceProvider, ProviderMetadata> = {
  nylas: {
    provider: "nylas",
    authorEmailField: "from",
    label: "Email",
    description: "Email messages synced from a Nylas-connected mailbox.",
    icon: Mail,
    defaultName: "Emails",
    defaultProviderConfig: {},
    defaultAutomatedParsingIsAllowed: true,
    capabilities: {
      supportsRemoteSync: true,
      supportsArchiveUpload: false,
      supportsDropoffUpload: false,
      hasRawBytesPersisted: true,
      supportsAutomatedPipeline: true,
      supportsManualFetch: false,
    },
  },
  imap: {
    provider: "imap",
    authorEmailField: "from",
    label: "Email (IMAP)",
    description:
      "Email messages synced directly from an IMAP mailbox (no Nylas).",
    icon: Inbox,
    defaultName: "Emails",
    defaultProviderConfig: { mailbox: "INBOX" },
    defaultAutomatedParsingIsAllowed: true,
    capabilities: {
      supportsRemoteSync: true,
      supportsArchiveUpload: false,
      supportsDropoffUpload: false,
      hasRawBytesPersisted: true,
      supportsAutomatedPipeline: true,
      supportsManualFetch: false,
    },
  },
  gchat: {
    provider: "gchat",
    authorEmailField: "participants",
    label: "Google Chat",
    description: "Messages and attachments from a Google Chat space.",
    icon: MessageSquare,
    defaultName: "Google Chat",
    defaultProviderConfig: {},
    defaultAutomatedParsingIsAllowed: true,
    capabilities: {
      supportsRemoteSync: true,
      supportsArchiveUpload: false,
      supportsDropoffUpload: false,
      hasRawBytesPersisted: true,
      supportsAutomatedPipeline: true,
      supportsManualFetch: false,
    },
  },
  gdrive: {
    provider: "gdrive",
    authorEmailField: "participants",
    label: "Google Drive",
    description: "Files synced from a Google Drive folder.",
    icon: HardDrive,
    defaultName: "Google Drive",
    defaultProviderConfig: {},
    defaultAutomatedParsingIsAllowed: true,
    capabilities: {
      supportsRemoteSync: true,
      supportsArchiveUpload: false,
      supportsDropoffUpload: false,
      hasRawBytesPersisted: true,
      supportsAutomatedPipeline: true,
      supportsManualFetch: false,
    },
  },
  dropoff: {
    provider: "dropoff",
    authorEmailField: null,
    label: "Files Drop Off",
    description: "Ad-hoc files uploaded via the Drop Off dialog.",
    icon: Upload,
    defaultName: "Files Drop Off",
    defaultProviderConfig: {},
    defaultAutomatedParsingIsAllowed: false,
    capabilities: {
      supportsRemoteSync: false,
      supportsArchiveUpload: false,
      supportsDropoffUpload: true,
      hasRawBytesPersisted: false,
      supportsAutomatedPipeline: false,
      supportsManualFetch: false,
    },
  },
  whatsapp: {
    provider: "whatsapp",
    authorEmailField: null,
    label: "WhatsApp Archive",
    description: "WhatsApp chat archives uploaded as a folder export.",
    icon: MessageCircle,
    defaultName: "WhatsApp Archive",
    defaultProviderConfig: {},
    defaultAutomatedParsingIsAllowed: false,
    capabilities: {
      supportsRemoteSync: false,
      supportsArchiveUpload: true,
      supportsDropoffUpload: false,
      hasRawBytesPersisted: true,
      supportsAutomatedPipeline: false,
      supportsManualFetch: false,
    },
  },
  aichat: {
    provider: "aichat",
    authorEmailField: null,
    label: "AI Chat",
    description: "Save AI-Chat data to the system context.",
    icon: Bot,
    defaultName: "AI Chat",
    defaultProviderConfig: {},
    defaultAutomatedParsingIsAllowed: false,
    capabilities: {
      supportsRemoteSync: false,
      supportsArchiveUpload: false,
      supportsDropoffUpload: false,
      hasRawBytesPersisted: false,
      supportsAutomatedPipeline: false,
      supportsManualFetch: false,
    },
  },
  telegram: {
    provider: "telegram",
    authorEmailField: null,
    label: "Telegram",
    description: "Messages forwarded or DM'd to a per-org Telegram bot.",
    icon: Send,
    defaultName: "Telegram Bot",
    defaultProviderConfig: {},
    // Telegram is push-ingested via webhook — there is no remote API to
    // pull from, so `supportsRemoteSync` is false (excluded from
    // `runFullSync()` / the per-source Sync button). But the items it
    // pushes DO flow through the parse/upload pipeline, so the automated
    // pipeline flag is on. The message body is persisted in
    // `metadata_json.rawText` (like WhatsApp), so Re-parse is supported.
    defaultAutomatedParsingIsAllowed: true,
    capabilities: {
      supportsRemoteSync: false,
      supportsArchiveUpload: false,
      supportsDropoffUpload: false,
      hasRawBytesPersisted: true,
      supportsAutomatedPipeline: true,
      supportsManualFetch: true,
    },
  },
}

export const PROVIDER_LIST: ProviderMetadata[] = Object.values(PROVIDERS)

// Defensive lookup. Falls through to a synthetic entry if a row carries
// a provider value that's not in the registry yet (would only happen
// during a deploy where the enum migration ran but the code hasn't
// shipped — extremely brief window, but better to render the row than
// crash the page).
export function getProvider(p: SourceProvider | string): ProviderMetadata {
  const meta = (PROVIDERS as Record<string, ProviderMetadata | undefined>)[p]
  if (meta) return meta
  return {
    provider: p as SourceProvider,
    label: p,
    description: "",
    icon: Upload,
    defaultName: p,
    defaultProviderConfig: {},
    defaultAutomatedParsingIsAllowed: false,
    authorEmailField: null,
    capabilities: {
      supportsRemoteSync: false,
      supportsArchiveUpload: false,
      supportsDropoffUpload: false,
      hasRawBytesPersisted: false,
      supportsAutomatedPipeline: false,
      supportsManualFetch: false,
    },
  }
}

export function syncableProviders(): SourceProvider[] {
  return PROVIDER_LIST.filter((p) => p.capabilities.supportsRemoteSync).map(
    (p) => p.provider,
  )
}

export function automatedPipelineProviders(): SourceProvider[] {
  return PROVIDER_LIST.filter(
    (p) => p.capabilities.supportsAutomatedPipeline,
  ).map((p) => p.provider)
}
