"use server"

import { db } from "@/db/drizzle"
import {
  deal,
  dealContact,
  dealFunnelStage,
  client,
  contact,
  user,
  dealStatus,
  type DealStatus,
} from "@/db/schema"
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"

export type DealContactSummary = { id: string; name: string }

export type DealRow = {
  id: string
  name: string
  description: string | null
  reasoning: string | null
  changes: string | null
  funnelStageId: string
  funnelStageName: string
  funnelStageProbability: number
  clientId: string
  clientName: string | null
  contacts: DealContactSummary[]
  value: string | null
  currency: string
  status: DealStatus
  // Fractional-indexing key for manual kanban order within a stage; null until
  // the deal is first dragged (board sorts null to the end by updatedAt).
  position: string | null
  userId: string
  userName: string | null
  organizationId: string
  createdAt: string
  updatedAt: string
}

export type DealClientOption = { id: string; name: string }
export type DealContactOption = {
  id: string
  name: string
  clientId: string | null
}
export type DealFunnelStageOption = {
  id: string
  name: string
  closureProbability: number
  sortOrder: number
  isSystem: boolean
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertDealInOrg(dealId: string, organizationId: string) {
  const rows = await db
    .select()
    .from(deal)
    .where(eq(deal.id, dealId))
    .limit(1)
  const current = rows[0]
  if (!current) throw new Error("Deal not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

async function assertClientInOrg(clientId: string, organizationId: string) {
  const rows = await db
    .select()
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const current = rows[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid client")
  }
}

async function assertFunnelStageAccessible(
  funnelStageId: string,
  organizationId: string,
) {
  const rows = await db
    .select()
    .from(dealFunnelStage)
    .where(eq(dealFunnelStage.id, funnelStageId))
    .limit(1)
  const stage = rows[0]
  if (!stage) throw new Error("Invalid funnel stage")
  if (!stage.isActive) throw new Error("Funnel stage is inactive")
  // System stage is always available; org-scoped stage must match the caller.
  if (
    !stage.isSystem &&
    stage.ownerOrganizationId !== organizationId
  ) {
    throw new Error("Invalid funnel stage")
  }
  return stage
}

async function assertContactsInOrg(
  contactIds: string[],
  organizationId: string,
) {
  if (contactIds.length === 0) return
  const unique = Array.from(new Set(contactIds))
  const rows = await db
    .select({ id: contact.id, organizationId: contact.organizationId })
    .from(contact)
    .where(inArray(contact.id, unique))
  if (rows.length !== unique.length) {
    throw new Error("One or more contacts not found")
  }
  for (const row of rows) {
    if (row.organizationId !== organizationId) {
      throw new Error("One or more contacts not in this organization")
    }
  }
}

function normaliseCurrency(input: string | undefined | null): string {
  const raw = (input ?? "USD").trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(raw)) {
    throw new Error("Currency must be a 3-letter ISO code")
  }
  return raw
}

// Drizzle's `numeric` accepts string or number; we normalise to a fixed
// 2-decimal string so the column store is consistent regardless of how the
// caller framed the input (form string vs. parsed number).
function normaliseValue(
  input: number | string | null | undefined,
): string | null {
  if (input === null || input === undefined || input === "") return null
  const n = typeof input === "number" ? input : Number(input)
  if (!Number.isFinite(n)) throw new Error("Invalid deal value")
  if (n < 0) throw new Error("Deal value must be non-negative")
  return n.toFixed(2)
}

// Resolution: if the org has any active org-scoped stages, return ONLY
// those (the org has explicitly customised its funnel). Otherwise fall
// back to the platform-wide system stages. Mirrors the org-vs-system
// pattern used elsewhere in the project — orgs that haven't opted in
// inherit the default; orgs that have, get exactly what they configured
// without bleed-through from the system bucket.
export async function listDealFunnelStages(): Promise<DealFunnelStageOption[]> {
  const { activeOrgId } = await requireOrgContext()

  const orgRows = await db
    .select({
      id: dealFunnelStage.id,
      name: dealFunnelStage.name,
      closureProbability: dealFunnelStage.closureProbability,
      sortOrder: dealFunnelStage.sortOrder,
      isSystem: dealFunnelStage.isSystem,
    })
    .from(dealFunnelStage)
    .where(
      and(
        eq(dealFunnelStage.isActive, true),
        eq(dealFunnelStage.isSystem, false),
        eq(dealFunnelStage.ownerOrganizationId, activeOrgId),
      ),
    )
    .orderBy(asc(dealFunnelStage.sortOrder), asc(dealFunnelStage.name))

  if (orgRows.length > 0) {
    return orgRows.map((r) => ({
      id: r.id,
      name: r.name,
      closureProbability: Number(r.closureProbability),
      sortOrder: r.sortOrder,
      isSystem: r.isSystem,
    }))
  }

  const systemRows = await db
    .select({
      id: dealFunnelStage.id,
      name: dealFunnelStage.name,
      closureProbability: dealFunnelStage.closureProbability,
      sortOrder: dealFunnelStage.sortOrder,
      isSystem: dealFunnelStage.isSystem,
    })
    .from(dealFunnelStage)
    .where(
      and(
        eq(dealFunnelStage.isActive, true),
        eq(dealFunnelStage.isSystem, true),
      ),
    )
    .orderBy(asc(dealFunnelStage.sortOrder), asc(dealFunnelStage.name))

  return systemRows.map((r) => ({
    id: r.id,
    name: r.name,
    closureProbability: Number(r.closureProbability),
    sortOrder: r.sortOrder,
    isSystem: r.isSystem,
  }))
}

// Picker scope: any non-suspended, non-deleted client in the org. We
// deliberately include `initial` (auto-discovered, not yet reviewed)
// alongside `active` so operators can attach deals to freshly-discovered
// clients without having to bounce through the Clients tab to flip the
// status first. `suspended` (archived) and `deleted` (soft-deleted) are both
// excluded.
export async function listDealClientOptions(): Promise<DealClientOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        ne(client.status, "suspended"),
        ne(client.status, "deleted"),
      ),
    )
    .orderBy(client.name)
  return rows
}

export async function listDealContactOptions(
  clientId?: string | null,
): Promise<DealContactOption[]> {
  const { activeOrgId } = await requireOrgContext()
  // Same scope rule as the client picker — `initial` contacts surface
  // alongside `active`; `suspended` and `deleted` stay hidden.
  const conditions = [
    eq(contact.organizationId, activeOrgId),
    ne(contact.status, "suspended"),
    ne(contact.status, "deleted"),
  ]
  if (clientId) {
    conditions.push(eq(contact.clientId, clientId))
  }
  const rows = await db
    .select({
      id: contact.id,
      name: contact.name,
      clientId: contact.clientId,
    })
    .from(contact)
    .where(and(...conditions))
    .orderBy(contact.name)
  return rows
}

export async function listDeals(
  options?: { includeCancelled?: boolean; includeDeleted?: boolean },
): Promise<DealRow[]> {
  const { activeOrgId } = await requireOrgContext()

  // `active` always shows. `cancelled` / `deleted` are soft-deleted and only
  // surface when explicitly requested — the board passes both flags and does
  // the final hide/show client-side so toggling doesn't refetch.
  const allowedStatuses: DealStatus[] = ["active"]
  if (options?.includeCancelled) allowedStatuses.push("cancelled")
  if (options?.includeDeleted) allowedStatuses.push("deleted")

  const conditions = [
    eq(deal.organizationId, activeOrgId),
    inArray(deal.status, allowedStatuses),
  ]

  const rows = await db
    .select({
      deal,
      funnelStageName: dealFunnelStage.name,
      funnelStageProbability: dealFunnelStage.closureProbability,
      clientName: client.name,
      userName: user.name,
    })
    .from(deal)
    .innerJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
    .leftJoin(client, eq(deal.clientId, client.id))
    .leftJoin(user, eq(deal.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(deal.updatedAt))

  // Single follow-up query for all attached contacts to avoid N+1.
  const dealIds = rows.map((r) => r.deal.id)
  const contactsByDeal = new Map<string, DealContactSummary[]>()
  if (dealIds.length > 0) {
    const contactRows = await db
      .select({
        dealId: dealContact.dealId,
        id: contact.id,
        name: contact.name,
      })
      .from(dealContact)
      .innerJoin(contact, eq(dealContact.contactId, contact.id))
      .where(inArray(dealContact.dealId, dealIds))
      .orderBy(contact.name)
    for (const c of contactRows) {
      const list = contactsByDeal.get(c.dealId) ?? []
      list.push({ id: c.id, name: c.name })
      contactsByDeal.set(c.dealId, list)
    }
  }

  return rows.map((r) => ({
    id: r.deal.id,
    name: r.deal.name,
    description: r.deal.description,
    reasoning: r.deal.reasoning,
    changes: r.deal.changes,
    funnelStageId: r.deal.funnelStageId,
    funnelStageName: r.funnelStageName,
    funnelStageProbability: Number(r.funnelStageProbability),
    clientId: r.deal.clientId,
    clientName: r.clientName,
    contacts: contactsByDeal.get(r.deal.id) ?? [],
    value: r.deal.value,
    currency: r.deal.currency,
    status: r.deal.status,
    position: r.deal.position,
    userId: r.deal.userId,
    userName: r.userName,
    organizationId: r.deal.organizationId,
    createdAt: r.deal.createdAt.toISOString(),
    updatedAt: r.deal.updatedAt.toISOString(),
  }))
}

export async function getDeal(dealId: string): Promise<DealRow | null> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({
      deal,
      funnelStageName: dealFunnelStage.name,
      funnelStageProbability: dealFunnelStage.closureProbability,
      clientName: client.name,
      userName: user.name,
    })
    .from(deal)
    .innerJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
    .leftJoin(client, eq(deal.clientId, client.id))
    .leftJoin(user, eq(deal.userId, user.id))
    .where(eq(deal.id, dealId))
    .limit(1)

  const r = rows[0]
  if (!r) return null
  if (r.deal.organizationId !== activeOrgId) return null

  const contactRows = await db
    .select({ id: contact.id, name: contact.name })
    .from(dealContact)
    .innerJoin(contact, eq(dealContact.contactId, contact.id))
    .where(eq(dealContact.dealId, dealId))
    .orderBy(contact.name)

  return {
    id: r.deal.id,
    name: r.deal.name,
    description: r.deal.description,
    reasoning: r.deal.reasoning,
    changes: r.deal.changes,
    funnelStageId: r.deal.funnelStageId,
    funnelStageName: r.funnelStageName,
    funnelStageProbability: Number(r.funnelStageProbability),
    clientId: r.deal.clientId,
    clientName: r.clientName,
    contacts: contactRows,
    value: r.deal.value,
    currency: r.deal.currency,
    status: r.deal.status,
    position: r.deal.position,
    userId: r.deal.userId,
    userName: r.userName,
    organizationId: r.deal.organizationId,
    createdAt: r.deal.createdAt.toISOString(),
    updatedAt: r.deal.updatedAt.toISOString(),
  }
}

export async function createDeal(data: {
  name: string
  description?: string | null
  funnelStageId: string
  clientId: string
  contactIds?: string[]
  value?: number | string | null
  currency?: string | null
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.name?.trim()) throw new Error("Name is required")
  if (!data.clientId) throw new Error("Client is required")
  if (!data.funnelStageId) throw new Error("Funnel stage is required")

  await assertClientInOrg(data.clientId, activeOrgId)
  await assertFunnelStageAccessible(data.funnelStageId, activeOrgId)
  const contactIds = data.contactIds ?? []
  await assertContactsInOrg(contactIds, activeOrgId)

  const value = normaliseValue(data.value)
  const currency = normaliseCurrency(data.currency)

  const id = randomUUID()
  const now = new Date()

  await db.insert(deal).values({
    id,
    name: data.name.trim(),
    description: data.description?.trim() || null,
    funnelStageId: data.funnelStageId,
    clientId: data.clientId,
    value,
    currency,
    status: "active",
    userId: session.user.id,
    organizationId: activeOrgId,
    createdAt: now,
    updatedAt: now,
  })

  if (contactIds.length > 0) {
    await db
      .insert(dealContact)
      .values(
        Array.from(new Set(contactIds)).map((contactId) => ({
          dealId: id,
          contactId,
        })),
      )
  }

  return { id }
}

export async function updateDeal(
  dealId: string,
  data: {
    name?: string
    description?: string | null
    funnelStageId?: string
    clientId?: string
    contactIds?: string[]
    value?: number | string | null
    currency?: string | null
    status?: DealStatus
  },
) {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)

  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name is required")
  }
  if (data.clientId !== undefined) {
    await assertClientInOrg(data.clientId, activeOrgId)
  }
  if (data.funnelStageId !== undefined) {
    await assertFunnelStageAccessible(data.funnelStageId, activeOrgId)
  }
  if (data.contactIds !== undefined) {
    await assertContactsInOrg(data.contactIds, activeOrgId)
  }

  const patch: Record<string, unknown> = {}
  if (data.name !== undefined) patch.name = data.name.trim()
  if (data.description !== undefined) {
    patch.description = data.description?.trim() || null
  }
  if (data.funnelStageId !== undefined) patch.funnelStageId = data.funnelStageId
  if (data.clientId !== undefined) patch.clientId = data.clientId
  if (data.value !== undefined) patch.value = normaliseValue(data.value)
  if (data.currency !== undefined) {
    patch.currency = normaliseCurrency(data.currency)
  }
  if (data.status !== undefined) {
    if (!dealStatus.enumValues.includes(data.status)) {
      throw new Error("Invalid deal status")
    }
    patch.status = data.status
  }

  if (Object.keys(patch).length > 0) {
    await db.update(deal).set(patch).where(eq(deal.id, dealId))
  }

  // Replace-style contact membership update: delete the existing edges,
  // insert the new set. Simpler than diffing; the cardinality here is small.
  if (data.contactIds !== undefined) {
    await db.delete(dealContact).where(eq(dealContact.dealId, dealId))
    const unique = Array.from(new Set(data.contactIds))
    if (unique.length > 0) {
      await db
        .insert(dealContact)
        .values(unique.map((contactId) => ({ dealId, contactId })))
    }
  }
}

// Status-only shortcut (mirrors tasks' `updateTaskStatus`). Used by the
// `statusOnly` PUT path for quick cancel / delete / restore toggles.
export async function setDealStatus(dealId: string, status: DealStatus) {
  const { activeOrgId } = await requireOrgContext()
  if (!dealStatus.enumValues.includes(status)) {
    throw new Error("Invalid deal status")
  }
  await assertDealInOrg(dealId, activeOrgId)
  await db.update(deal).set({ status }).where(eq(deal.id, dealId))
}

// Kanban drag: move a deal to a column (funnel stage) at a manual-order slot.
// The CLIENT computes `position` via fractional-indexing (computePosition in
// src/lib/kanban-move.ts) from the neighbours at the drop point; the server
// only validates tenant + stage ownership and writes both fields. This is the
// only path that sets `deal.position`. (`updatedAt` bumps via $onUpdate — a
// drag counts as a touch, same as the stage-move dropdown.)
export async function moveDeal(
  dealId: string,
  data: { funnelStageId: string; position: string },
) {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  await assertFunnelStageAccessible(data.funnelStageId, activeOrgId)
  if (typeof data.position !== "string" || data.position.length === 0) {
    throw new Error("Invalid position")
  }
  await db
    .update(deal)
    .set({ funnelStageId: data.funnelStageId, position: data.position })
    .where(eq(deal.id, dealId))
}

