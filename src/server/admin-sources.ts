"use server"

import { db } from "@/db/drizzle"
import { source, organization } from "@/db/schema"
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
} from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { encryptCredentials } from "@/lib/credentials-crypto"
import { randomUUID } from "crypto"
import type {
  SourceProvider,
  SourceStatus,
  SourceType,
} from "@/db/schema"

export type AdminSource = {
  id: string
  type: SourceType
  provider: SourceProvider
  name: string
  description: string | null
  isSystem: boolean
  ownerOrganizationId: string | null
  ownerOrganizationName: string | null
  providerConfig: Record<string, unknown>
  hasCredentials: boolean
  status: SourceStatus
  automatedParsingIsAllowed: boolean
  createdAt: string
  updatedAt: string
}

export type AdminSourceListFilters = {
  provider?: SourceProvider | null
  searchName?: string
  showInactive?: boolean
  limit?: number
  offset?: number
}

export type AdminSourceInput = {
  name: string
  description?: string | null
  type: SourceType
  provider: SourceProvider
  isSystem: boolean
  ownerOrganizationId?: string | null
  providerConfig?: Record<string, unknown>
  status: SourceStatus
  automatedParsingIsAllowed?: boolean
}

async function requireAdmin() {
  const session = await getServerSession()
  if (!session || session.user.role !== "admin") {
    throw new Error("Unauthorized")
  }
  return session
}

export async function listAdminSources(filters: AdminSourceListFilters) {
  await requireAdmin()
  const limit = filters.limit ?? 5
  const offset = filters.offset ?? 0

  const conds = []
  if (filters.provider) conds.push(eq(source.provider, filters.provider))
  if (filters.searchName?.trim()) {
    conds.push(ilike(source.name, `%${filters.searchName.trim()}%`))
  }
  if (!filters.showInactive) {
    conds.push(eq(source.status, "active"))
  }
  const where = conds.length > 0 ? and(...conds) : undefined

  const rows = await db
    .select({
      id: source.id,
      type: source.type,
      provider: source.provider,
      name: source.name,
      description: source.description,
      isSystem: source.isSystem,
      ownerOrganizationId: source.ownerOrganizationId,
      ownerOrganizationName: organization.name,
      providerConfig: source.providerConfig,
      credentialsRef: source.credentialsRef,
      status: source.status,
      automatedParsingIsAllowed: source.automatedParsingIsAllowed,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    })
    .from(source)
    .leftJoin(organization, eq(source.ownerOrganizationId, organization.id))
    .where(where)
    .orderBy(desc(source.createdAt))
    .limit(limit)
    .offset(offset)

  const totalRow = await db
    .select({ count: count() })
    .from(source)
    .where(where)

  const sources: AdminSource[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    provider: r.provider,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    ownerOrganizationId: r.ownerOrganizationId,
    ownerOrganizationName: r.ownerOrganizationName,
    providerConfig:
      (r.providerConfig as Record<string, unknown> | null) ?? {},
    hasCredentials: !!r.credentialsRef,
    status: r.status,
    automatedParsingIsAllowed: r.automatedParsingIsAllowed,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))

  return { sources, total: totalRow[0]?.count ?? 0 }
}

export async function createAdminSource(input: AdminSourceInput) {
  const session = await requireAdmin()
  validateInput(input)

  const id = randomUUID()
  await db.insert(source).values({
    id,
    type: input.type,
    provider: input.provider,
    isSystem: input.isSystem,
    ownerOrganizationId: input.isSystem
      ? null
      : input.ownerOrganizationId ?? null,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    providerConfig: input.providerConfig ?? {},
    // Credentials are NEVER set here. The admin's create flow lands a
    // row with credentialsRef=null and the schema-driven dialog
    // (`/api/admin/sources/credentials`) writes them in a second step.
    credentialsRef: null,
    status: input.status,
    automatedParsingIsAllowed: input.automatedParsingIsAllowed ?? true,
    createdByUserId: session.user.id,
  })
  return { id }
}

export async function updateAdminSource(
  sourceId: string,
  input: Partial<AdminSourceInput>,
) {
  await requireAdmin()

  const update: Record<string, unknown> = {}
  if (input.name !== undefined) update.name = input.name.trim()
  if (input.description !== undefined) {
    update.description = input.description?.trim() || null
  }
  if (input.type !== undefined) update.type = input.type
  if (input.provider !== undefined) update.provider = input.provider
  if (input.status !== undefined) update.status = input.status
  if (input.isSystem !== undefined) {
    update.isSystem = input.isSystem
    if (input.isSystem) update.ownerOrganizationId = null
  }
  if (
    input.ownerOrganizationId !== undefined &&
    !(input.isSystem === true)
  ) {
    update.ownerOrganizationId = input.ownerOrganizationId
  }
  if (input.providerConfig !== undefined) {
    update.providerConfig = input.providerConfig
  }
  // Credentials are NOT touched by this update path — the
  // schema-driven dialog at `/api/admin/sources/credentials` is the
  // sole writer of `credentials_ref`. Same for provider config edits
  // that go through `/api/admin/sources/config`.
  if (input.automatedParsingIsAllowed !== undefined) {
    update.automatedParsingIsAllowed = input.automatedParsingIsAllowed
  }

  if (Object.keys(update).length === 0) return

  await db.update(source).set(update).where(eq(source.id, sourceId))
}

// ── Admin provider-config update ──────────────────────────────────────
//
// Mirrors the owner-side `updateOwnerOrgSourceProviderConfig` but skips
// the org-ownership check — admin can edit any source's
// `provider_config`. Validated against the per-provider zod schema.
export async function updateAdminSourceProviderConfig(
  sourceId: string,
  plainProviderConfig: unknown,
): Promise<void> {
  await requireAdmin()

  const rows = await db
    .select({ id: source.id, provider: source.provider })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error(`Source not found: ${sourceId}`)

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

// ── Admin credentials update ──────────────────────────────────────────
//
// Validates a plaintext credentials payload against the per-provider
// zod schema declared in `src/server/providers/handlers.ts`, encrypts,
// and writes to `source.credentials_ref`. Mirrors the owner-side flow
// (`updateOwnerOrgSourceCredentials`) but skips the org-ownership
// check — admin can edit any source. Throws `ZodError` on invalid
// payload (route translates to 400) and `Error` on missing source or
// provider with no credentials schema.
export async function updateAdminSourceCredentials(
  sourceId: string,
  plainCredentials: unknown,
): Promise<void> {
  await requireAdmin()

  const rows = await db
    .select({ id: source.id, provider: source.provider })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error(`Source not found: ${sourceId}`)

  const { getHandler } = await import("@/server/providers/handlers")
  const handler = getHandler(row.provider)
  if (!handler.credentialsSchema) {
    throw new Error(
      `Provider '${row.provider}' does not accept credentials (no schema)`,
    )
  }

  const validated = handler.credentialsSchema.parse(plainCredentials)
  const ciphertext = encryptCredentials(validated)

  await db
    .update(source)
    .set({ credentialsRef: ciphertext })
    .where(eq(source.id, sourceId))
}

export async function listOrgOptionsForAdmin() {
  await requireAdmin()
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .orderBy(asc(organization.name))
}

function validateInput(input: AdminSourceInput) {
  if (!input.name?.trim()) throw new Error("name is required")
  if (!input.provider) throw new Error("provider is required")
  if (!input.isSystem && !input.ownerOrganizationId) {
    throw new Error(
      "ownerOrganizationId is required when isSystem is false",
    )
  }
}

