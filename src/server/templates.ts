"use server"

// Server functions for the source-template dictionary (Phase 2).
//
// Templates are the platform-wide catalogue of source variants. Per-org
// `source` rows are instantiated from templates via
// `instantiateFromTemplate`. Templates carry no credentials — those are
// per-org by definition (each org's own Workspace SA / Nylas grant) and
// live on the instance row's `credentials_ref` instead.
//
// Soft-delete only via `status = 'inactive'`. Existing instances keep
// their `template_id` even when the template is inactive (kept callable
// for future re-instantiation or admin oversight).

import { db } from "@/db/drizzle"
import {
  source,
  sourceTemplate,
  type SourceProvider,
  type SourceStatus,
  type SourceType,
  type SourceTemplate,
} from "@/db/schema"
import { and, asc, desc, eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { getServerSession } from "@/lib/get-session"

// ── Auth helpers (mirrors admin-sources.ts pattern) ──────────────────

async function requireAdmin() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  if (session.user?.role !== "admin") {
    throw new Error("Forbidden — not an admin")
  }
  return session
}

// ── Public types ─────────────────────────────────────────────────────

export type TemplateRow = {
  id: string
  type: SourceType
  provider: SourceProvider
  name: string
  description: string | null
  defaultProviderConfig: Record<string, unknown>
  defaultAutomatedParsingIsAllowed: boolean
  isDefault: boolean
  isVisibleToOrgs: boolean
  status: SourceStatus
  createdAt: string
  updatedAt: string
}

export type TemplateInput = {
  type: SourceType
  provider: SourceProvider
  name: string
  description?: string | null
  defaultProviderConfig?: Record<string, unknown>
  defaultAutomatedParsingIsAllowed?: boolean
  isDefault?: boolean
  isVisibleToOrgs?: boolean
  status?: SourceStatus
}

function toTemplateRow(t: SourceTemplate): TemplateRow {
  return {
    id: t.id,
    type: t.type,
    provider: t.provider,
    name: t.name,
    description: t.description,
    defaultProviderConfig:
      (t.defaultProviderConfig as Record<string, unknown> | null) ?? {},
    defaultAutomatedParsingIsAllowed: t.defaultAutomatedParsingIsAllowed,
    isDefault: t.isDefault,
    isVisibleToOrgs: t.isVisibleToOrgs,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }
}

// ── Admin: full list ─────────────────────────────────────────────────

export async function listAdminTemplates(opts?: {
  showInactive?: boolean
}): Promise<TemplateRow[]> {
  await requireAdmin()
  const where = opts?.showInactive ? undefined : eq(sourceTemplate.status, "active")
  const rows = await db
    .select()
    .from(sourceTemplate)
    .where(where ?? eq(sourceTemplate.id, sourceTemplate.id))
    .orderBy(desc(sourceTemplate.isDefault), asc(sourceTemplate.name))
  return rows.map(toTemplateRow)
}

// ── Org-owner: list templates available for instantiation ───────────
//
// Filters to `status='active'` AND `is_visible_to_orgs=true`. Org
// owners use this to populate the "Add source" picker. NO admin gate —
// any authenticated org member can read this list (the actual create
// is guarded by `requireOrgOwner`).
export async function listInstantiableTemplates(): Promise<TemplateRow[]> {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const rows = await db
    .select()
    .from(sourceTemplate)
    .where(
      and(
        eq(sourceTemplate.status, "active"),
        eq(sourceTemplate.isVisibleToOrgs, true),
      ),
    )
    .orderBy(asc(sourceTemplate.name))
  return rows.map(toTemplateRow)
}

// ── Admin: create / update ──────────────────────────────────────────

export async function createTemplate(input: TemplateInput): Promise<{ id: string }> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error("name is required")
  const id = randomUUID()
  await db.insert(sourceTemplate).values({
    id,
    type: input.type,
    provider: input.provider,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    defaultProviderConfig: input.defaultProviderConfig ?? {},
    defaultAutomatedParsingIsAllowed:
      input.defaultAutomatedParsingIsAllowed ?? true,
    isDefault: input.isDefault ?? false,
    isVisibleToOrgs: input.isVisibleToOrgs ?? true,
    status: input.status ?? "active",
  })
  return { id }
}

export async function updateTemplate(
  templateId: string,
  patch: Partial<TemplateInput>,
): Promise<void> {
  await requireAdmin()
  const updates: Record<string, unknown> = {}
  if (patch.type !== undefined) updates.type = patch.type
  if (patch.provider !== undefined) updates.provider = patch.provider
  if (patch.name !== undefined) updates.name = patch.name.trim()
  if (patch.description !== undefined) {
    updates.description = patch.description?.trim() || null
  }
  if (patch.defaultProviderConfig !== undefined) {
    updates.defaultProviderConfig = patch.defaultProviderConfig
  }
  if (patch.defaultAutomatedParsingIsAllowed !== undefined) {
    updates.defaultAutomatedParsingIsAllowed = patch.defaultAutomatedParsingIsAllowed
  }
  if (patch.isDefault !== undefined) updates.isDefault = patch.isDefault
  if (patch.isVisibleToOrgs !== undefined) updates.isVisibleToOrgs = patch.isVisibleToOrgs
  if (patch.status !== undefined) updates.status = patch.status
  if (Object.keys(updates).length === 0) return
  await db
    .update(sourceTemplate)
    .set(updates)
    .where(eq(sourceTemplate.id, templateId))
}

// ── Instantiation ────────────────────────────────────────────────────
//
// Copies a template's defaults into a new `source` row scoped to the
// given organisation. Credentials are NEVER copied (templates carry
// none); the row lands with `credentials_ref = null` and the owner
// fills it in via the existing schema-driven dialog.
//
// `idempotent`: if true (used by the org-creation bootstrap hook + the
// lazy aichat provisioner), checks for an existing row with the same
// `(orgId, templateId)` and returns its id without inserting. False by
// default — the org-owner "Add source" UI calls this without
// idempotency so an explicit second click creates a second instance
// (rare, but valid for e.g. multiple Drive folders pointing at the
// same template).
export async function instantiateFromTemplate(opts: {
  organizationId: string
  templateId: string
  createdByUserId?: string | null
  idempotent?: boolean
}): Promise<{ id: string; created: boolean }> {
  const tplRows = await db
    .select()
    .from(sourceTemplate)
    .where(eq(sourceTemplate.id, opts.templateId))
    .limit(1)
  const tpl = tplRows[0]
  if (!tpl) throw new Error(`Template not found: ${opts.templateId}`)
  if (tpl.status !== "active") {
    throw new Error(`Template is inactive: ${opts.templateId}`)
  }

  if (opts.idempotent) {
    const existing = await db
      .select({ id: source.id })
      .from(source)
      .where(
        and(
          eq(source.ownerOrganizationId, opts.organizationId),
          eq(source.templateId, opts.templateId),
        ),
      )
      .limit(1)
    if (existing[0]) {
      return { id: existing[0].id, created: false }
    }
  }

  const id = randomUUID()
  await db.insert(source).values({
    id,
    templateId: tpl.id,
    type: tpl.type,
    provider: tpl.provider,
    providerConfig:
      (tpl.defaultProviderConfig as Record<string, unknown> | null) ?? {},
    ownerOrganizationId: opts.organizationId,
    isSystem: false,
    automatedParsingIsAllowed: tpl.defaultAutomatedParsingIsAllowed,
    name: tpl.name,
    description: tpl.description,
    credentialsRef: null,
    status: "active",
    createdByUserId: opts.createdByUserId ?? null,
  })
  return { id, created: true }
}

// ── Bootstrap: instantiate every is_default template for an org ─────
//
// Called from the org-creation hook in `auth.ts`. Idempotent — re-
// running for the same org skips templates already instantiated.
export async function bootstrapDefaultsForOrg(
  organizationId: string,
  createdByUserId?: string | null,
): Promise<{ instantiated: number; alreadyExisted: number }> {
  const defaults = await db
    .select({ id: sourceTemplate.id })
    .from(sourceTemplate)
    .where(
      and(
        eq(sourceTemplate.isDefault, true),
        eq(sourceTemplate.status, "active"),
      ),
    )

  let instantiated = 0
  let alreadyExisted = 0
  for (const tpl of defaults) {
    const r = await instantiateFromTemplate({
      organizationId,
      templateId: tpl.id,
      createdByUserId: createdByUserId ?? null,
      idempotent: true,
    })
    if (r.created) instantiated++
    else alreadyExisted++
  }
  return { instantiated, alreadyExisted }
}
