// Admin-only "source teardown / reset" (see refs/source-teardown.md). Given one
// source, hard-deletes everything it produced — its source_items + R2 markdown,
// the cards from them, and the clients/contacts/deals/tasks they triggered — and
// resets the sync cursor, so the same test/demo can be re-run cleanly with no
// dedup/attribution collisions.
//
// IMPORTANT: `import "server-only"`, NOT `"use server"`. This module exports a
// class + sync helpers + types consumed by the API routes — `"use server"`
// would restrict exports to async functions and the build would fail. The
// discovery key-aggregation is REIMPLEMENTED here (self-contained) rather than
// imported, because discovery.ts is itself `"use server"`.
import "server-only"

import { randomUUID } from "crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db } from "@/db/drizzle"
import {
  source,
  sourceItem,
  client,
  contact,
  deal,
  task,
  card,
  order,
  orderRequest,
  organization,
  teardownLog,
} from "@/db/schema"
import { companyMatchKey, personMatchKey } from "@/lib/translit-ru"
import { isAutomatedEmail } from "@/lib/is-automated-email"
import { getServerSession } from "@/lib/get-session"
import { deleteFromR2 } from "@/lib/r2"

export class TeardownError extends Error {
  constructor(
    public readonly reason:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "bad_request",
    message: string,
  ) {
    super(message)
    this.name = "TeardownError"
  }
}

// ── Admin gate ────────────────────────────────────────────────────────
// Platform admin only (`user.role === 'admin'`), same gate as /settings.
async function requireAdmin(): Promise<{ userId: string }> {
  const session = await getServerSession()
  if (!session?.user) throw new TeardownError("unauthorized", "Unauthorized")
  if (session.user.role !== "admin") {
    throw new TeardownError("forbidden", "Admin role required")
  }
  return { userId: session.user.id }
}

// ── Self-contained metadata reader (the key aggregation) ──────────────
// Mirrors discovery's extraction without importing it.

type Meta = Record<string, unknown>

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

// Company keys an item produces: organizations[].name + .aliases[], plus the
// flat companies[] list. Key = companyMatchKey(name).
function companyKeysFromMeta(meta: Meta): string[] {
  const keys = new Set<string>()
  for (const o of asArray(meta.organizations)) {
    if (o && typeof o === "object") {
      const rec = o as Record<string, unknown>
      const k = companyMatchKey(str(rec.name))
      if (k) keys.add(k)
      for (const a of asArray(rec.aliases)) {
        const ak = companyMatchKey(str(a))
        if (ak) keys.add(ak)
      }
    }
  }
  for (const c of asArray(meta.companies)) {
    const k = companyMatchKey(str(c))
    if (k) keys.add(k)
  }
  return [...keys]
}

// Contact keys an item produces, mirroring the three sources discovery reads:
// participants[], the Nylas envelope from/to/cc/bcc[], and mentionedPeople[].
// Key = lower(email) when present (non-automated) else `name:${personMatchKey}`.
function contactKeysFromMeta(meta: Meta): string[] {
  const keys = new Set<string>()
  const consider = (rawEmail: unknown, rawName: unknown) => {
    const email = str(rawEmail).trim().toLowerCase()
    if (email) {
      if (!isAutomatedEmail(email)) keys.add(email)
      return
    }
    const pk = personMatchKey(str(rawName))
    if (pk) keys.add(`name:${pk}`)
  }
  for (const p of asArray(meta.participants)) {
    if (p && typeof p === "object")
      consider((p as Record<string, unknown>).email, (p as Record<string, unknown>).name)
  }
  for (const field of ["from", "to", "cc", "bcc"] as const) {
    for (const p of asArray(meta[field])) {
      if (p && typeof p === "object")
        consider((p as Record<string, unknown>).email, (p as Record<string, unknown>).name)
    }
  }
  for (const p of asArray(meta.mentionedPeople)) {
    if (p && typeof p === "object")
      consider((p as Record<string, unknown>).email, (p as Record<string, unknown>).name)
  }
  return [...keys]
}

// Classify a row (by its keys) against the org-wide key→items map + the target
// item set. `matched` = any producing item is in target; `exclusive` = ALL
// producing items are in target; `otherItemCount` = producing items outside.
function classify(
  rowKeys: string[],
  keyToItems: Map<string, Set<string>>,
  targetItemIds: Set<string>,
): { matched: boolean; exclusive: boolean; otherItemCount: number } {
  const producing = new Set<string>()
  for (const k of rowKeys) {
    const s = keyToItems.get(k)
    if (s) for (const id of s) producing.add(id)
  }
  let outside = 0
  let inside = 0
  for (const id of producing) {
    if (targetItemIds.has(id)) inside++
    else outside++
  }
  return {
    matched: inside > 0,
    exclusive: inside > 0 && outside === 0,
    otherItemCount: outside,
  }
}

// ── resolve — shared by preview + execute ─────────────────────────────

type ClientMatch = {
  id: string
  name: string
  exclusive: boolean
  otherItemCount: number
  hasOrders: boolean
}
type ContactMatch = {
  id: string
  name: string
  exclusive: boolean
  otherItemCount: number
}

type Resolved = {
  source: { id: string; name: string; organizationId: string }
  targetItemIds: Set<string>
  sourceItemCount: number
  childItemCount: number
  r2Keys: string[]
  cardIds: string[]
  clients: ClientMatch[]
  contacts: ContactMatch[]
}

async function resolve(sourceId: string): Promise<Resolved> {
  // 1. Load the source.
  const srcRows = await db
    .select({
      id: source.id,
      name: source.name,
      organizationId: source.ownerOrganizationId,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const src = srcRows[0]
  if (!src || !src.organizationId) {
    throw new TeardownError("not_found", "Source not found")
  }
  const orgId = src.organizationId

  // 2. Load ALL org source_items (org-wide is required for exclusivity).
  const items = await db
    .select({
      id: sourceItem.id,
      sourceId: sourceItem.sourceId,
      parentSourceItemId: sourceItem.parentSourceItemId,
      markdownR2Key: sourceItem.markdownR2Key,
      metadataJson: sourceItem.metadataJson,
    })
    .from(sourceItem)
    .where(eq(sourceItem.organizationId, orgId))

  // 3. Target = items belonging to THIS source (parent + children share sourceId).
  const targetItemIds = new Set<string>()
  const r2Keys: string[] = []
  let childItemCount = 0
  for (const it of items) {
    if (it.sourceId !== sourceId) continue
    targetItemIds.add(it.id)
    if (it.markdownR2Key) r2Keys.push(it.markdownR2Key)
    if (it.parentSourceItemId) childItemCount++
  }

  // 4. Build the org-wide key → items maps.
  const companyKeyToItems = new Map<string, Set<string>>()
  const contactKeyToItems = new Map<string, Set<string>>()
  const addKey = (map: Map<string, Set<string>>, key: string, itemId: string) => {
    let s = map.get(key)
    if (!s) {
      s = new Set()
      map.set(key, s)
    }
    s.add(itemId)
  }
  for (const it of items) {
    const meta = (it.metadataJson as Meta | null) ?? {}
    for (const k of companyKeysFromMeta(meta)) addKey(companyKeyToItems, k, it.id)
    for (const k of contactKeysFromMeta(meta)) addKey(contactKeyToItems, k, it.id)
  }

  // 5. Clients (skip soft-deleted) — classify by company keys.
  const clientRows = await db
    .select({
      id: client.id,
      name: client.name,
      aliases: client.aliases,
      status: client.status,
    })
    .from(client)
    .where(eq(client.organizationId, orgId))
  const matchedClients = clientRows
    .filter((c) => c.status !== "deleted")
    .map((c) => {
      const keys = [c.name, ...(c.aliases ?? [])]
        .map((s) => companyMatchKey(s))
        .filter(Boolean)
      const { matched, exclusive, otherItemCount } = classify(
        keys,
        companyKeyToItems,
        targetItemIds,
      )
      return { row: c, matched, exclusive, otherItemCount }
    })
    .filter((m) => m.matched)

  // 6. Order check — clients with an order OR order_request can't be hard-
  //    deleted (both FK-restrict on client). Detect → skip + warn.
  const matchedClientIds = matchedClients.map((m) => m.row.id)
  const orderBlockedIds = new Set<string>()
  if (matchedClientIds.length > 0) {
    const orderRows = await db
      .select({ clientId: order.clientId })
      .from(order)
      .where(inArray(order.clientId, matchedClientIds))
    for (const r of orderRows) orderBlockedIds.add(r.clientId)
    const reqRows = await db
      .select({ clientId: orderRequest.clientId })
      .from(orderRequest)
      .where(inArray(orderRequest.clientId, matchedClientIds))
    for (const r of reqRows) orderBlockedIds.add(r.clientId)
  }

  const clients: ClientMatch[] = matchedClients.map((m) => ({
    id: m.row.id,
    name: m.row.name,
    exclusive: m.exclusive,
    otherItemCount: m.otherItemCount,
    hasOrders: orderBlockedIds.has(m.row.id),
  }))

  // 7. Contacts (skip soft-deleted) — classify by email + person-name keys.
  const contactRows = await db
    .select({
      id: contact.id,
      name: contact.name,
      nameNative: contact.nameNative,
      aliases: contact.aliases,
      email: contact.email,
      status: contact.status,
    })
    .from(contact)
    .where(eq(contact.organizationId, orgId))
  const contacts: ContactMatch[] = contactRows
    .filter((c) => c.status !== "deleted")
    .map((c) => {
      const keys: string[] = []
      const email = (c.email ?? "").trim().toLowerCase()
      if (email) keys.push(email)
      for (const n of [c.name, c.nameNative, ...(c.aliases ?? [])]) {
        const pk = personMatchKey(n ?? "")
        if (pk) keys.push(`name:${pk}`)
      }
      const { matched, exclusive, otherItemCount } = classify(
        keys,
        contactKeyToItems,
        targetItemIds,
      )
      return { row: c, matched, exclusive, otherItemCount }
    })
    .filter((m) => m.matched)
    .map((m) => ({
      id: m.row.id,
      name: m.row.nameNative || m.row.name,
      exclusive: m.exclusive,
      otherItemCount: m.otherItemCount,
    }))

  // 8. Cards from this source's items.
  const cardRows =
    targetItemIds.size > 0
      ? await db
          .select({ id: card.id })
          .from(card)
          .where(
            and(
              eq(card.organizationId, orgId),
              inArray(card.sourceItemId, [...targetItemIds]),
            ),
          )
      : []

  return {
    source: { id: src.id, name: src.name, organizationId: orgId },
    targetItemIds,
    sourceItemCount: targetItemIds.size,
    childItemCount,
    r2Keys,
    cardIds: cardRows.map((r) => r.id),
    clients,
    contacts,
  }
}

// ── Public API ────────────────────────────────────────────────────────

export type TeardownSource = {
  id: string
  name: string
  provider: string
  organizationId: string
  organizationName: string | null
  itemCount: number
}

// Cross-org picker for the admin tool — every source + its item count.
export async function listTeardownSources(): Promise<TeardownSource[]> {
  await requireAdmin()
  const rows = await db
    .select({
      id: source.id,
      name: source.name,
      provider: source.provider,
      organizationId: source.ownerOrganizationId,
      organizationName: organization.name,
      itemCount: sql<number>`count(${sourceItem.id})`,
    })
    .from(source)
    .leftJoin(organization, eq(organization.id, source.ownerOrganizationId))
    .leftJoin(sourceItem, eq(sourceItem.sourceId, source.id))
    .groupBy(source.id, organization.name)
    .orderBy(organization.name, source.name)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    provider: r.provider,
    organizationId: r.organizationId ?? "",
    organizationName: r.organizationName,
    itemCount: Number(r.itemCount),
  }))
}

export type TeardownPreview = {
  source: { id: string; name: string; organizationId: string }
  counts: {
    sourceItems: number
    childItems: number
    r2Objects: number
    cards: number
    clients: number
    contacts: number
    deals: number
    tasks: number
  }
  clients: ClientMatch[]
  contacts: ContactMatch[]
  blockedByOrders: { id: string; name: string }[]
}

// Count deals + tasks that the default delete set (exclusive, non-order-blocked
// clients/contacts) would remove.
async function countDealsAndTasks(
  clientIds: string[],
  contactIds: string[],
): Promise<{ dealIds: string[]; taskIds: string[] }> {
  const dealIds: string[] = []
  if (clientIds.length > 0) {
    const rows = await db
      .select({ id: deal.id })
      .from(deal)
      .where(inArray(deal.clientId, clientIds))
    for (const r of rows) dealIds.push(r.id)
  }
  // Tasks linking any deleted deal / client / contact.
  const taskIds = new Set<string>()
  const collectTasks = async (col: AnyPgColumn, ids: string[]) => {
    if (ids.length === 0) return
    const rows = await db
      .select({ id: task.id })
      .from(task)
      .where(inArray(col, ids))
    for (const r of rows) taskIds.add(r.id)
  }
  await collectTasks(task.clientId, clientIds)
  await collectTasks(task.contactId, contactIds)
  await collectTasks(task.dealId, dealIds)
  return { dealIds, taskIds: [...taskIds] }
}

export async function previewSourceTeardown(
  sourceId: string,
): Promise<TeardownPreview> {
  await requireAdmin()
  const r = await resolve(sourceId)

  // Default delete set = exclusive rows; clients also minus order-blocked.
  const delClientIds = r.clients
    .filter((c) => c.exclusive && !c.hasOrders)
    .map((c) => c.id)
  const delContactIds = r.contacts.filter((c) => c.exclusive).map((c) => c.id)
  const { dealIds, taskIds } = await countDealsAndTasks(delClientIds, delContactIds)

  return {
    source: r.source,
    counts: {
      sourceItems: r.sourceItemCount,
      childItems: r.childItemCount,
      r2Objects: r.r2Keys.length,
      cards: r.cardIds.length,
      clients: delClientIds.length,
      contacts: delContactIds.length,
      deals: dealIds.length,
      tasks: taskIds.length,
    },
    clients: r.clients,
    contacts: r.contacts,
    blockedByOrders: r.clients
      .filter((c) => c.hasOrders)
      .map((c) => ({ id: c.id, name: c.name })),
  }
}

export type TeardownCounts = TeardownPreview["counts"]

export async function executeSourceTeardown(input: {
  sourceId: string
  confirmText: string
  includeSharedClientIds?: string[]
  includeSharedContactIds?: string[]
}): Promise<TeardownCounts> {
  const { userId } = await requireAdmin()
  const r = await resolve(input.sourceId)

  // Re-validate the typed confirmation server-side (never trust the client).
  if ((input.confirmText ?? "").trim() !== r.source.name.trim()) {
    throw new TeardownError(
      "bad_request",
      "Confirmation text does not match the source name",
    )
  }

  const sharedClientOptIn = new Set(input.includeSharedClientIds ?? [])
  const sharedContactOptIn = new Set(input.includeSharedContactIds ?? [])

  // Final sets = exclusive + opted-in shared, minus order-blocked clients.
  const finalClientIds = r.clients
    .filter(
      (c) => !c.hasOrders && (c.exclusive || sharedClientOptIn.has(c.id)),
    )
    .map((c) => c.id)
  const finalContactIds = r.contacts
    .filter((c) => c.exclusive || sharedContactOptIn.has(c.id))
    .map((c) => c.id)

  const { dealIds, taskIds } = await countDealsAndTasks(
    finalClientIds,
    finalContactIds,
  )

  // ── Delete in FK-safe order (see refs/source-teardown.md §3) ──────────
  // R2 objects → tasks → deals → cards → contacts → clients → source_items →
  // reset cursor → teardown_log.
  const r2Deleted = await deleteFromR2(r.r2Keys)

  if (taskIds.length > 0)
    await db.delete(task).where(inArray(task.id, taskIds))
  if (dealIds.length > 0)
    await db.delete(deal).where(inArray(deal.id, dealIds)) // cascades deal_contact
  if (r.cardIds.length > 0)
    await db.delete(card).where(inArray(card.id, r.cardIds)) // cascades card_* junctions
  if (finalContactIds.length > 0)
    await db.delete(contact).where(inArray(contact.id, finalContactIds))
  if (finalClientIds.length > 0)
    await db.delete(client).where(inArray(client.id, finalClientIds))
  // Source items: delete by source_id (parent + children share it; children
  // also cascade via parent_source_item_id).
  await db.delete(sourceItem).where(eq(sourceItem.sourceId, input.sourceId))

  // Reset the sync cursor so an incremental re-sync re-fetches the old messages.
  await db
    .update(source)
    .set({ lastSyncedAt: null })
    .where(eq(source.id, input.sourceId))

  const counts: TeardownCounts = {
    sourceItems: r.sourceItemCount,
    childItems: r.childItemCount,
    r2Objects: r2Deleted,
    cards: r.cardIds.length,
    clients: finalClientIds.length,
    contacts: finalContactIds.length,
    deals: dealIds.length,
    tasks: taskIds.length,
  }

  await db.insert(teardownLog).values({
    id: randomUUID(),
    organizationId: r.source.organizationId,
    sourceId: r.source.id,
    sourceName: r.source.name,
    adminUserId: userId,
    counts,
  })

  return counts
}
