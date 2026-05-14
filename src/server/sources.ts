// Not "use server" — that directive only allows async-function exports,
// and this module also exports the SourceScopeError class + plain
// types. `server-only` keeps the module out of the client bundle and
// trips a build error if it ever gets pulled in.
import "server-only"

import { db } from "@/db/drizzle"
import {
  member,
  source,
  type SourceProvider,
  type SourceStatus,
} from "@/db/schema"
import { and, asc, eq } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"

// Lightweight summary used by the Sources page action bar, the per-table
// source filter, and anywhere else that needs to render a list of
// available sources. Same shape for system + per-org sources — the page
// fetches both and renders them under separate tabs.
export type SourceSummary = {
  id: string
  provider: SourceProvider
  name: string
  providerConfig: Record<string, unknown>
}

// Backwards-compatible alias — older imports use SystemSource.
export type SystemSource = SourceSummary

// Sources owned by a specific organization. Membership is enforced at
// the call site via `session.session.activeOrganizationId` so this
// function trusts whatever orgId it's given.
export async function listOrgSources(
  organizationId: string,
): Promise<SourceSummary[]> {
  const rows = await db
    .select({
      id: source.id,
      provider: source.provider,
      name: source.name,
      providerConfig: source.providerConfig,
    })
    .from(source)
    .where(
      and(
        eq(source.ownerOrganizationId, organizationId),
        eq(source.status, "active"),
      ),
    )
    .orderBy(asc(source.createdAt))

  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    name: r.name,
    providerConfig: (r.providerConfig as Record<string, unknown> | null) ?? {},
  }))
}

// Verifies a source belongs to the given org (or is a system source —
// kept callable so org members can act on shared platform sources once
// those exist again). Throws on mismatch / not-found so API routes can
// catch and translate to 403/404. Also returns the provider so callers
// can short-circuit before doing more work.
export async function assertSourceInScope(
  sourceId: string,
  organizationId: string,
): Promise<{ id: string; provider: SourceProvider }> {
  const rows = await db
    .select({
      id: source.id,
      provider: source.provider,
      ownerOrganizationId: source.ownerOrganizationId,
      isSystem: source.isSystem,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new SourceScopeError("not_found", "Source not found")
  if (!row.isSystem && row.ownerOrganizationId !== organizationId) {
    throw new SourceScopeError("forbidden", "Source not in scope")
  }
  return { id: row.id, provider: row.provider }
}

export class SourceScopeError extends Error {
  constructor(
    public readonly reason: "not_found" | "forbidden",
    message: string,
  ) {
    super(message)
    this.name = "SourceScopeError"
  }
}

// ── Org-owner editable view ──────────────────────────────────────────
//
// Used by the new "Manage organization sources" tab on the Sources page.
// Returns the same identity fields as `listOrgSources` plus the columns
// the owner can flip (status, automatedParsingIsAllowed). Credentials
// and providerConfig are intentionally NOT exposed here — owners use
// this surface only to schedule things; deep config still lives in the
// admin Settings page.
export type OwnerOrgSource = {
  id: string
  provider: SourceProvider
  name: string
  description: string | null
  status: SourceStatus
  automatedParsingIsAllowed: boolean
  lastSyncedAt: string | null
  // Boolean projection of `source.credentials_ref` — true iff the row
  // has an encrypted credentials blob. The blob itself is intentionally
  // never returned: credentials are write-only from the UI's
  // perspective. The owner sees "Configured ✓" or "Not configured" and
  // re-pastes to update.
  credentialsConfigured: boolean
  // Non-secret connection routing (spaceId, driveId, …). Returned as-is
  // so the provider-config dialog can pre-fill its form. Safe to expose
  // — anything sensitive lives in `credentials_ref` instead.
  providerConfig: Record<string, unknown>
  // FK back to the template this row was instantiated from. Nullable
  // because the FK uses `set null` on template hard-delete. Exposed so
  // the "Add source" dialog can show an "you already have N of these"
  // hint when the picker offers a template the org already uses.
  templateId: string | null
}

// Resolves the caller's role in their active organization. Used to gate
// the owner-only Sources tab + its mutations. Returns `null` (rather
// than throwing) for the "not signed in / no active org / not a
// member" cases so callers can branch on visibility cheaply.
export async function getActiveOrgRole(): Promise<{
  organizationId: string
  role: string
} | null> {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) return null
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, activeOrgId),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { organizationId: activeOrgId, role: row.role }
}

async function requireOrgOwner(): Promise<{ organizationId: string }> {
  const role = await getActiveOrgRole()
  if (!role) throw new OrgOwnerError("unauthorized", "Unauthorized")
  if (role.role !== "owner") {
    throw new OrgOwnerError("forbidden", "Only the org owner can do this")
  }
  return { organizationId: role.organizationId }
}

export class OrgOwnerError extends Error {
  constructor(
    public readonly reason: "unauthorized" | "forbidden",
    message: string,
  ) {
    super(message)
    this.name = "OrgOwnerError"
  }
}

export async function listOwnerOrgSources(): Promise<OwnerOrgSource[]> {
  const { organizationId } = await requireOrgOwner()
  const rows = await db
    .select({
      id: source.id,
      provider: source.provider,
      name: source.name,
      description: source.description,
      status: source.status,
      automatedParsingIsAllowed: source.automatedParsingIsAllowed,
      lastSyncedAt: source.lastSyncedAt,
      credentialsRef: source.credentialsRef,
      providerConfig: source.providerConfig,
      templateId: source.templateId,
    })
    .from(source)
    .where(eq(source.ownerOrganizationId, organizationId))
    .orderBy(asc(source.createdAt))

  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    name: r.name,
    description: r.description,
    status: r.status,
    automatedParsingIsAllowed: r.automatedParsingIsAllowed,
    lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
    credentialsConfigured: r.credentialsRef !== null,
    providerConfig: (r.providerConfig as Record<string, unknown> | null) ?? {},
    templateId: r.templateId,
  }))
}

// Owner-side patch surface. Only the schedule + soft-disable knobs are
// editable from this path; deeper edits (provider, credentials, system
// flag) stay in the platform-admin Settings UI.
export type OwnerOrgSourceUpdate = {
  automatedParsingIsAllowed?: boolean
  status?: SourceStatus
}

export async function updateOwnerOrgSource(
  sourceId: string,
  update: OwnerOrgSourceUpdate,
): Promise<void> {
  const { organizationId } = await requireOrgOwner()

  // Verify the row belongs to the caller's org before touching it.
  // assertSourceInScope returns on system rows (org-null) too — but
  // owners shouldn't be flipping platform-wide flags from their tab,
  // so only allow when ownerOrganizationId actually matches.
  const rows = await db
    .select({
      id: source.id,
      ownerOrganizationId: source.ownerOrganizationId,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new SourceScopeError("not_found", "Source not found")
  if (row.ownerOrganizationId !== organizationId) {
    throw new SourceScopeError("forbidden", "Source not in scope")
  }

  const patch: Record<string, unknown> = {}
  if (update.automatedParsingIsAllowed !== undefined) {
    patch.automatedParsingIsAllowed = update.automatedParsingIsAllowed
  }
  if (update.status !== undefined) {
    patch.status = update.status
  }
  if (Object.keys(patch).length === 0) return

  await db.update(source).set(patch).where(eq(source.id, sourceId))
}

// ── Owner-side identity update (name + description) ─────────────────
//
// Org owners can rename their sources and edit the description shown
// on the manage tab. Provider, type, isSystem, etc. stay admin-only.
export type OwnerOrgSourceIdentityUpdate = {
  name?: string
  description?: string | null
}

export async function updateOwnerOrgSourceIdentity(
  sourceId: string,
  patch: OwnerOrgSourceIdentityUpdate,
): Promise<void> {
  const { organizationId } = await requireOrgOwner()

  const rows = await db
    .select({
      id: source.id,
      ownerOrganizationId: source.ownerOrganizationId,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new SourceScopeError("not_found", "Source not found")
  if (row.ownerOrganizationId !== organizationId) {
    throw new SourceScopeError("forbidden", "Source not in scope")
  }

  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim()
    if (!trimmed) throw new Error("name must be a non-empty string")
    updates.name = trimmed
  }
  if (patch.description !== undefined) {
    updates.description = patch.description?.trim() || null
  }
  if (Object.keys(updates).length === 0) return

  await db.update(source).set(updates).where(eq(source.id, sourceId))
}

// ── Owner-side provider-config update ─────────────────────────────────
//
// Validates the non-secret connection routing payload (e.g. spaceId,
// driveId) against the per-provider zod schema declared in
// `src/server/providers/handlers.ts`, then writes to
// `source.provider_config`. Org-owner only; tenant-scoped.
//
// Read-write (unlike credentials which are write-only): provider config
// is non-secret so the form pre-fills with the existing values to make
// edits friendly. The credentials path stays write-only.
export async function updateOwnerOrgSourceProviderConfig(
  sourceId: string,
  plainProviderConfig: unknown,
): Promise<void> {
  const { organizationId } = await requireOrgOwner()

  const rows = await db
    .select({
      id: source.id,
      provider: source.provider,
      ownerOrganizationId: source.ownerOrganizationId,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new SourceScopeError("not_found", "Source not found")
  if (row.ownerOrganizationId !== organizationId) {
    throw new SourceScopeError("forbidden", "Source not in scope")
  }

  const { getHandler } = await import("@/server/providers/handlers")
  const handler = getHandler(row.provider)
  if (!handler.providerConfigSchema) {
    throw new Error(
      `Provider '${row.provider}' has no configurable provider_config`,
    )
  }
  const validated = handler.providerConfigSchema.parse(plainProviderConfig)

  await db
    .update(source)
    .set({ providerConfig: validated })
    .where(eq(source.id, sourceId))
}

// ── Owner-side credentials update ─────────────────────────────────────
//
// Validates the plain credentials payload against the provider's zod
// schema, encrypts via `credentials-crypto.ts`, and writes the result
// to `source.credentials_ref`. Throws on:
//   - non-owner / no active org (`OrgOwnerError`)
//   - source not in scope (`SourceScopeError`)
//   - provider has no credentialsSchema (e.g. dropoff/whatsapp/aichat)
//   - payload fails zod validation
//
// Plaintext credentials are NEVER returned anywhere. The form accepts
// them on input, the server encrypts and discards. Updates that arrive
// with the same payload still re-encrypt (fresh IV, new ciphertext) —
// no "no-op" path that compares against the existing blob.
export async function updateOwnerOrgSourceCredentials(
  sourceId: string,
  plainCredentials: unknown,
): Promise<void> {
  const { organizationId } = await requireOrgOwner()

  const rows = await db
    .select({
      id: source.id,
      provider: source.provider,
      ownerOrganizationId: source.ownerOrganizationId,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new SourceScopeError("not_found", "Source not found")
  if (row.ownerOrganizationId !== organizationId) {
    throw new SourceScopeError("forbidden", "Source not in scope")
  }

  // Imports kept local so client bundles never reach into server-only
  // crypto / handler-registry by accident. (`sources.ts` is server-only
  // already; this is belt-and-braces.)
  const { getHandler } = await import("@/server/providers/handlers")
  const { encryptCredentials } = await import("@/lib/credentials-crypto")
  const handler = getHandler(row.provider)
  if (!handler.credentialsSchema) {
    throw new Error(
      `Provider '${row.provider}' does not accept credentials (no schema)`,
    )
  }

  // Zod parse — throws ZodError on bad payload, surfaced to the route
  // handler which translates it to a 400.
  const validated = handler.credentialsSchema.parse(plainCredentials)
  const ciphertext = encryptCredentials(validated)

  await db
    .update(source)
    .set({ credentialsRef: ciphertext })
    .where(eq(source.id, sourceId))
}

// ── Lazy provisioning of internal sources ────────────────────────────

// Look up (or insert on first call) the per-org "AI Chat" source. Used
// by `/api/sources/aichat/save` so users don't need an admin step before
// hitting the Save Chat button on /dashboard.
//
// Phase 2: this is now a thin wrapper around `instantiateFromTemplate`
// — it finds the active aichat template (`provider='aichat'`,
// `status='active'`) and idempotently instantiates it for the given
// org. The template MUST exist (seeded via
// `scripts/seed-templates.ts`); if not, the call throws so missing seed
// data surfaces loudly in dev.
export async function getOrCreateAiChatSource(
  organizationId: string,
): Promise<{ id: string; created: boolean }> {
  const { sourceTemplate } = await import("@/db/schema")
  const tplRows = await db
    .select({ id: sourceTemplate.id })
    .from(sourceTemplate)
    .where(
      and(
        eq(sourceTemplate.provider, "aichat"),
        eq(sourceTemplate.status, "active"),
      ),
    )
    .limit(1)
  const tpl = tplRows[0]
  if (!tpl) {
    throw new Error(
      "No active aichat template found. Run `pnpm tsx scripts/seed-templates.ts --apply` to seed the template dictionary.",
    )
  }
  const { instantiateFromTemplate } = await import("@/server/templates")
  return instantiateFromTemplate({
    organizationId,
    templateId: tpl.id,
    idempotent: true,
  })
}
