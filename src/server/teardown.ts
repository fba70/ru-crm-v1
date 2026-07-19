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

// A teardown unit: one top-level source_item (parent) + its children
// (attachments / audio / .ics), i.e. "one test email and its parts".
type ThreadInfo = {
  id: string // parent (root) source_item id
  title: string
  date: string | null // ISO
  itemIds: Set<string> // parent + children
  cardIds: string[]
}

// An existing client/contact with the org-wide set of source_items that produce
// its dedup keys (company keys / email / person-name). `producing` is the exact
// set the next sync would dedup against — exclusivity is decided from it.
type EntityProducers = {
  id: string
  name: string
  status: string
  orderCount: number // orders + order-requests (clients only; 0 for contacts)
  producing: Set<string>
}

type Resolved = {
  source: { id: string; name: string; organizationId: string }
  // Ordered newest-first.
  threads: ThreadInfo[]
  sourceItemIds: Set<string>
  r2KeyByItem: Map<string, string>
  clients: EntityProducers[]
  contacts: EntityProducers[]
}

// Pick a human title for a thread root from its metadata.
function threadTitle(meta: Meta, externalId: string): string {
  const subject = str(meta.subject).trim()
  if (subject) return subject
  const snippet = str(meta.snippet).trim()
  if (snippet) return snippet.length > 80 ? snippet.slice(0, 80) + "…" : snippet
  const title = str(meta.title).trim()
  if (title) return title
  return externalId || "(без названия)"
}

// ── resolve — shared by preview + execute ─────────────────────────────
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
      externalId: sourceItem.externalId,
      sourceCreatedAt: sourceItem.sourceCreatedAt,
      createdAt: sourceItem.createdAt,
    })
    .from(sourceItem)
    .where(eq(sourceItem.organizationId, orgId))

  // 3. This source's items + group them into threads (parent + children).
  const sourceItemIds = new Set<string>()
  const r2KeyByItem = new Map<string, string>()
  // root id → ThreadInfo (built first for parents, then children attached).
  const threadById = new Map<string, ThreadInfo>()
  // child item id → its root id, for attaching children whose parent we've seen.
  const ourItems = items.filter((it) => it.sourceId === sourceId)
  for (const it of ourItems) {
    sourceItemIds.add(it.id)
    if (it.markdownR2Key) r2KeyByItem.set(it.id, it.markdownR2Key)
  }
  // Parents (roots): no parentSourceItemId. Children attach to their root; a
  // child whose parent isn't in this source (shouldn't happen) becomes its own
  // root so it's never silently dropped.
  for (const it of ourItems) {
    if (it.parentSourceItemId) continue
    const meta = (it.metadataJson as Meta | null) ?? {}
    threadById.set(it.id, {
      id: it.id,
      title: threadTitle(meta, it.externalId),
      date: (it.sourceCreatedAt ?? it.createdAt)?.toISOString() ?? null,
      itemIds: new Set([it.id]),
      cardIds: [],
    })
  }
  for (const it of ourItems) {
    if (!it.parentSourceItemId) continue
    const root = threadById.get(it.parentSourceItemId)
    if (root) root.itemIds.add(it.id)
    else {
      // Orphaned child (parent missing) — stand it up as its own thread.
      const meta = (it.metadataJson as Meta | null) ?? {}
      threadById.set(it.id, {
        id: it.id,
        title: threadTitle(meta, it.externalId),
        date: (it.sourceCreatedAt ?? it.createdAt)?.toISOString() ?? null,
        itemIds: new Set([it.id]),
        cardIds: [],
      })
    }
  }

  // 4. Org-wide key → producing items maps.
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

  // 5. Clients (INCLUDING soft-deleted, so a reset also clears tombstones) →
  //    producing-item set from company keys. Keep only those produced by at
  //    least one of THIS source's items (the rest are unrelated).
  const clientRows = await db
    .select({
      id: client.id,
      name: client.name,
      aliases: client.aliases,
      status: client.status,
    })
    .from(client)
    .where(eq(client.organizationId, orgId))
  const producingOf = (
    keys: string[],
    map: Map<string, Set<string>>,
  ): Set<string> => {
    const producing = new Set<string>()
    for (const k of keys) {
      const s = map.get(k)
      if (s) for (const id of s) producing.add(id)
    }
    return producing
  }
  const touchesSource = (producing: Set<string>): boolean => {
    for (const id of producing) if (sourceItemIds.has(id)) return true
    return false
  }

  const matchedClients = clientRows
    .map((c) => {
      const keys = [c.name, ...(c.aliases ?? [])]
        .map((s) => companyMatchKey(s))
        .filter(Boolean)
      return { row: c, producing: producingOf(keys, companyKeyToItems) }
    })
    .filter((m) => touchesSource(m.producing))

  // 6. Order counts per matched client (orders + order_requests; cascade-deleted).
  const matchedClientIds = matchedClients.map((m) => m.row.id)
  const orderCountByClient = new Map<string, number>()
  if (matchedClientIds.length > 0) {
    const bump = (id: string) =>
      orderCountByClient.set(id, (orderCountByClient.get(id) ?? 0) + 1)
    const orderRows = await db
      .select({ clientId: order.clientId })
      .from(order)
      .where(inArray(order.clientId, matchedClientIds))
    for (const r of orderRows) bump(r.clientId)
    const reqRows = await db
      .select({ clientId: orderRequest.clientId })
      .from(orderRequest)
      .where(inArray(orderRequest.clientId, matchedClientIds))
    for (const r of reqRows) bump(r.clientId)
  }

  const clients: EntityProducers[] = matchedClients.map((m) => ({
    id: m.row.id,
    name: m.row.name,
    status: m.row.status,
    orderCount: orderCountByClient.get(m.row.id) ?? 0,
    producing: m.producing,
  }))

  // 7. Contacts (INCLUDING soft-deleted) → producing set from email + name keys.
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
  const contacts: EntityProducers[] = contactRows
    .map((c) => {
      const keys: string[] = []
      const email = (c.email ?? "").trim().toLowerCase()
      if (email) keys.push(email)
      for (const n of [c.name, c.nameNative, ...(c.aliases ?? [])]) {
        const pk = personMatchKey(n ?? "")
        if (pk) keys.push(`name:${pk}`)
      }
      return {
        row: c,
        producing: producingOf(keys, contactKeyToItems),
      }
    })
    .filter((m) => touchesSource(m.producing))
    .map((m) => ({
      id: m.row.id,
      name: m.row.nameNative || m.row.name,
      status: m.row.status,
      orderCount: 0,
      producing: m.producing,
    }))

  // 8. Cards → bucket into the thread whose items contain card.source_item_id.
  if (sourceItemIds.size > 0) {
    const cardRows = await db
      .select({ id: card.id, sourceItemId: card.sourceItemId })
      .from(card)
      .where(
        and(
          eq(card.organizationId, orgId),
          inArray(card.sourceItemId, [...sourceItemIds]),
        ),
      )
    const threads = [...threadById.values()]
    for (const cr of cardRows) {
      if (!cr.sourceItemId) continue
      const t = threads.find((th) => th.itemIds.has(cr.sourceItemId!))
      if (t) t.cardIds.push(cr.id)
    }
  }

  const threads = [...threadById.values()].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? ""),
  )

  return {
    source: { id: src.id, name: src.name, organizationId: orgId },
    threads,
    sourceItemIds,
    r2KeyByItem,
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

// A client/contact shown under a thread, with provenance badges so the operator
// sees the link between the thread and the artifacts it produced.
export type TeardownEntity = {
  id: string
  name: string
  status: string // 'active' | 'deleted' | 'blocked' — soft-deleted flagged in UI
  orderCount: number // cascade-deleted with the client (0 for contacts)
  // EVERY producing item is inside this thread → deleting just this thread
  // removes it ("только этот тред").
  exclusiveToThread: boolean
  // # of OTHER threads in THIS source that also produce it (select them too to
  // delete it).
  otherThreadsInSource: number
  // # of producing items in OTHER sources → can NEVER be removed by this
  // source's teardown (shown disabled, always kept).
  itemsInOtherSources: number
  // Every thread (in THIS source) that produces it — the client computes the
  // exact deletable set for the current selection (deletable iff
  // itemsInOtherSources === 0 AND producingThreadIds ⊆ selected).
  producingThreadIds: string[]
}

export type TeardownThread = {
  id: string
  title: string
  date: string | null
  itemCount: number
  cardCount: number
  clients: TeardownEntity[]
  contacts: TeardownEntity[]
}

export type TeardownPreview = {
  source: { id: string; name: string; organizationId: string }
  threads: TeardownThread[]
}

// Build the per-thread provenance view for one entity, relative to `thread`.
function entityForThread(
  e: EntityProducers,
  thread: ThreadInfo,
  threads: ThreadInfo[],
  sourceItemIds: Set<string>,
): TeardownEntity {
  let exclusiveToThread = true
  let itemsInOtherSources = 0
  for (const id of e.producing) {
    if (!thread.itemIds.has(id)) exclusiveToThread = false
    if (!sourceItemIds.has(id)) itemsInOtherSources++
  }
  let otherThreadsInSource = 0
  const producingThreadIds: string[] = []
  for (const t of threads) {
    let hit = false
    for (const id of e.producing) {
      if (t.itemIds.has(id)) {
        hit = true
        break
      }
    }
    if (!hit) continue
    producingThreadIds.push(t.id)
    if (t.id !== thread.id) otherThreadsInSource++
  }
  return {
    id: e.id,
    name: e.name,
    status: e.status,
    orderCount: e.orderCount,
    producingThreadIds,
    exclusiveToThread,
    otherThreadsInSource,
    itemsInOtherSources,
  }
}

export async function previewSourceTeardown(
  sourceId: string,
): Promise<TeardownPreview> {
  await requireAdmin()
  const r = await resolve(sourceId)

  const threads: TeardownThread[] = r.threads.map((t) => {
    const clients = r.clients
      .filter((e) => {
        for (const id of e.producing) if (t.itemIds.has(id)) return true
        return false
      })
      .map((e) => entityForThread(e, t, r.threads, r.sourceItemIds))
    const contacts = r.contacts
      .filter((e) => {
        for (const id of e.producing) if (t.itemIds.has(id)) return true
        return false
      })
      .map((e) => entityForThread(e, t, r.threads, r.sourceItemIds))
    return {
      id: t.id,
      title: t.title,
      date: t.date,
      itemCount: t.itemIds.size,
      cardCount: t.cardIds.length,
      clients,
      contacts,
    }
  })

  return { source: r.source, threads }
}

export type TeardownResult = {
  threads: number
  sourceItems: number
  r2Objects: number
  cards: number
  clients: number
  contacts: number
  deals: number
  tasks: number
  orders: number
  // Matched but KEPT because a producing item lies outside the selection.
  sharedSkipped: number
  cursorReset: boolean
}

// Count deals + tasks + orders that a given client/contact delete set removes
// (deals/orders FK-restrict on client → must go first; tasks are set-null but
// we delete them to actually clear the thread's tasks).
async function countCascade(
  clientIds: string[],
  contactIds: string[],
): Promise<{ dealIds: string[]; taskIds: string[]; orderCount: number }> {
  const dealIds: string[] = []
  let orderCount = 0
  if (clientIds.length > 0) {
    const rows = await db
      .select({ id: deal.id })
      .from(deal)
      .where(inArray(deal.clientId, clientIds))
    for (const r of rows) dealIds.push(r.id)
    const orderRows = await db
      .select({ id: order.id })
      .from(order)
      .where(inArray(order.clientId, clientIds))
    const reqRows = await db
      .select({ id: orderRequest.id })
      .from(orderRequest)
      .where(inArray(orderRequest.clientId, clientIds))
    orderCount = orderRows.length + reqRows.length
  }
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
  return { dealIds, taskIds: [...taskIds], orderCount }
}

export async function executeSourceTeardown(input: {
  sourceId: string
  confirmText: string
  // The threads (parent source_item ids) the operator chose to delete.
  threadIds: string[]
}): Promise<TeardownResult> {
  const { userId } = await requireAdmin()
  const r = await resolve(input.sourceId)

  // Re-validate the typed confirmation server-side (never trust the client).
  if ((input.confirmText ?? "").trim() !== r.source.name.trim()) {
    throw new TeardownError(
      "bad_request",
      "Confirmation text does not match the source name",
    )
  }

  // Selected threads (intersect requested with the resolved set) → their items.
  const requested = new Set(input.threadIds ?? [])
  const selectedThreads = r.threads.filter((t) => requested.has(t.id))
  if (selectedThreads.length === 0) {
    throw new TeardownError("bad_request", "No threads selected")
  }
  const selectedItemIds = new Set<string>()
  const selectedR2Keys: string[] = []
  const selectedCardIds: string[] = []
  for (const t of selectedThreads) {
    for (const id of t.itemIds) {
      selectedItemIds.add(id)
      const key = r.r2KeyByItem.get(id)
      if (key) selectedR2Keys.push(key)
    }
    for (const c of t.cardIds) selectedCardIds.push(c)
  }

  // An entity is deletable iff it's touched by the selection AND EVERY item
  // producing its keys is inside the selection (otherwise it's shared with a
  // thread/source we're not deleting → keep it). Server-authoritative.
  let sharedSkipped = 0
  const deletable = (e: EntityProducers): boolean => {
    let touched = false
    for (const id of e.producing) {
      if (selectedItemIds.has(id)) touched = true
      else return false // a producer outside the selection → shared, keep
    }
    if (!touched) return false
    return true
  }
  const finalClientIds: string[] = []
  for (const c of r.clients) {
    if (deletable(c)) finalClientIds.push(c.id)
    else if ([...c.producing].some((id) => selectedItemIds.has(id))) sharedSkipped++
  }
  const finalContactIds: string[] = []
  for (const c of r.contacts) {
    if (deletable(c)) finalContactIds.push(c.id)
    else if ([...c.producing].some((id) => selectedItemIds.has(id))) sharedSkipped++
  }

  const { dealIds, taskIds, orderCount } = await countCascade(
    finalClientIds,
    finalContactIds,
  )

  // ── Delete in FK-safe order (see refs/source-teardown.md §3) ──────────
  // R2 → tasks → deals → orders(+requests) → cards → contacts → clients →
  // source_items → (conditional) reset cursor → teardown_log.
  const r2Deleted = await deleteFromR2(selectedR2Keys)

  if (taskIds.length > 0)
    await db.delete(task).where(inArray(task.id, taskIds))
  if (dealIds.length > 0)
    await db.delete(deal).where(inArray(deal.id, dealIds)) // cascades deal_contact
  if (finalClientIds.length > 0) {
    // Orders + order-requests FK-restrict on client → delete before the client.
    // `order` cascades order_item + order_access_link; `order_request` cascades
    // order_request_item.
    await db.delete(order).where(inArray(order.clientId, finalClientIds))
    await db
      .delete(orderRequest)
      .where(inArray(orderRequest.clientId, finalClientIds))
  }
  if (selectedCardIds.length > 0)
    await db.delete(card).where(inArray(card.id, selectedCardIds)) // cascades card_* junctions
  if (finalContactIds.length > 0)
    await db.delete(contact).where(inArray(contact.id, finalContactIds))
  if (finalClientIds.length > 0)
    await db.delete(client).where(inArray(client.id, finalClientIds))
  // Source items: delete the selected threads' items (children cascade via
  // parent_source_item_id; deleting by id is explicit and selection-scoped).
  await db.delete(sourceItem).where(inArray(sourceItem.id, [...selectedItemIds]))

  // Reset the sync cursor ONLY on a full-source reset (every thread selected),
  // so a re-sync re-fetches from scratch. A partial (surgical) delete leaves the
  // cursor so the threads we KEPT aren't re-pulled / disturbed.
  const fullReset = selectedThreads.length === r.threads.length
  if (fullReset) {
    await db
      .update(source)
      .set({ lastSyncedAt: null })
      .where(eq(source.id, input.sourceId))
  }

  const result: TeardownResult = {
    threads: selectedThreads.length,
    sourceItems: selectedItemIds.size,
    r2Objects: r2Deleted,
    cards: selectedCardIds.length,
    clients: finalClientIds.length,
    contacts: finalContactIds.length,
    deals: dealIds.length,
    tasks: taskIds.length,
    orders: orderCount,
    sharedSkipped,
    cursorReset: fullReset,
  }

  await db.insert(teardownLog).values({
    id: randomUUID(),
    organizationId: r.source.organizationId,
    sourceId: r.source.id,
    sourceName: r.source.name,
    adminUserId: userId,
    counts: result,
  })

  return result
}
