"use server"

import { db } from "@/db/drizzle"
import {
  card,
  cardClient,
  cardContact,
  cardUser,
  client,
  contact,
  member,
  rule,
  sourceItem,
  user,
  type CardPriority,
  type CardCategory,
} from "@/db/schema"
import { and, desc, eq, inArray } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"

export type CardMessage = {
  analysis: string
  recommendation: string
  // Only set on `new_order` cards: the VERBATIM client message from the
  // source (Telegram `metadata_json.rawText`), stamped at generation time so
  // the card's "Create order" button can prefill the New Order dialog's
  // request field unchanged. Absent on every other category.
  orderRequest?: string
  // Short (3-5 word) action-oriented task title summarised from the card
  // context by the generation LLM. Used to prefill the task name when the
  // operator clicks "Принять". Absent on cards generated before this field
  // existed — the UI falls back to the category label.
  taskTitle?: string
}

export type CardClientRef = { id: string; name: string }
export type CardUserRef = { id: string; name: string; email: string }
// `clientId` lets the dashboard pair the contact with its owning client when
// prefilling the create-task dialog (the task form scopes contacts by client).
export type CardContactRef = { id: string; name: string; clientId: string | null }

export type CardRow = {
  id: string
  organizationId: string
  priority: CardPriority
  category: CardCategory
  message: CardMessage
  accepted: boolean
  rejectionReason: string | null
  sourceItemId: string | null
  sourceItemTitle: string | null
  ruleId: string | null
  ruleName: string | null
  clients: CardClientRef[]
  users: CardUserRef[]
  contacts: CardContactRef[]
  createdAt: string
  updatedAt: string
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertCardInOrg(cardId: string, organizationId: string) {
  const rows = await db.select().from(card).where(eq(card.id, cardId)).limit(1)
  const current = rows[0]
  if (!current) throw new Error("Card not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

async function assertSourceItemIfProvided(
  sourceItemId: string | null | undefined,
  organizationId: string,
) {
  if (!sourceItemId) return
  const rows = await db
    .select()
    .from(sourceItem)
    .where(eq(sourceItem.id, sourceItemId))
    .limit(1)
  const current = rows[0]
  if (!current) throw new Error("Invalid source item")
  // Items belonging to a system source have organizationId = null; cards
  // can reference those, but per-org items must match the active org.
  if (current.organizationId && current.organizationId !== organizationId) {
    throw new Error("Invalid source item")
  }
}

async function assertRuleIfProvided(
  ruleId: string | null | undefined,
  organizationId: string,
) {
  if (!ruleId) return
  const rows = await db.select().from(rule).where(eq(rule.id, ruleId)).limit(1)
  const current = rows[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid rule")
  }
}

async function assertClientIdsInOrg(ids: string[], organizationId: string) {
  if (ids.length === 0) return
  const unique = Array.from(new Set(ids))
  const rows = await db
    .select({ id: client.id, organizationId: client.organizationId })
    .from(client)
    .where(inArray(client.id, unique))
  if (rows.length !== unique.length) throw new Error("Invalid client reference")
  for (const r of rows) {
    if (r.organizationId !== organizationId) {
      throw new Error("Invalid client reference")
    }
  }
}

async function assertContactIdsInOrg(ids: string[], organizationId: string) {
  if (ids.length === 0) return
  const unique = Array.from(new Set(ids))
  const rows = await db
    .select({ id: contact.id, organizationId: contact.organizationId })
    .from(contact)
    .where(inArray(contact.id, unique))
  if (rows.length !== unique.length) {
    throw new Error("Invalid contact reference")
  }
  for (const r of rows) {
    if (r.organizationId !== organizationId) {
      throw new Error("Invalid contact reference")
    }
  }
}

async function assertUserIdsInOrg(ids: string[], organizationId: string) {
  if (ids.length === 0) return
  const unique = Array.from(new Set(ids))
  // user is global — gate via member rather than a column on user.
  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        inArray(member.userId, unique),
      ),
    )
  if (rows.length !== unique.length) {
    throw new Error("Invalid user reference")
  }
}

function normaliseMessage(raw: unknown): CardMessage {
  if (!raw || typeof raw !== "object") {
    return { analysis: "", recommendation: "" }
  }
  const obj = raw as Record<string, unknown>
  return {
    analysis: typeof obj.analysis === "string" ? obj.analysis : "",
    recommendation:
      typeof obj.recommendation === "string" ? obj.recommendation : "",
    ...(typeof obj.orderRequest === "string" && obj.orderRequest.length > 0
      ? { orderRequest: obj.orderRequest }
      : {}),
    ...(typeof obj.taskTitle === "string" && obj.taskTitle.trim().length > 0
      ? { taskTitle: obj.taskTitle.trim() }
      : {}),
  }
}

export async function listCards(): Promise<CardRow[]> {
  const { activeOrgId } = await requireOrgContext()

  const cardRows = await db
    .select({
      card,
      ruleName: rule.name,
      sourceItemFilename: sourceItem.filename,
      sourceItemExternalId: sourceItem.externalId,
    })
    .from(card)
    .leftJoin(rule, eq(card.ruleId, rule.id))
    .leftJoin(sourceItem, eq(card.sourceItemId, sourceItem.id))
    .where(eq(card.organizationId, activeOrgId))
    .orderBy(desc(card.createdAt))

  if (cardRows.length === 0) return []

  const cardIds = cardRows.map((r) => r.card.id)

  const [clientLinks, userLinks, contactLinks] = await Promise.all([
    db
      .select({
        cardId: cardClient.cardId,
        clientId: client.id,
        clientName: client.name,
      })
      .from(cardClient)
      .innerJoin(client, eq(cardClient.clientId, client.id))
      .where(inArray(cardClient.cardId, cardIds)),
    db
      .select({
        cardId: cardUser.cardId,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
      })
      .from(cardUser)
      .innerJoin(user, eq(cardUser.userId, user.id))
      .where(inArray(cardUser.cardId, cardIds)),
    db
      .select({
        cardId: cardContact.cardId,
        contactId: contact.id,
        contactName: contact.name,
        contactClientId: contact.clientId,
      })
      .from(cardContact)
      .innerJoin(contact, eq(cardContact.contactId, contact.id))
      .where(inArray(cardContact.cardId, cardIds)),
  ])

  const clientsByCard = new Map<string, CardClientRef[]>()
  for (const l of clientLinks) {
    const arr = clientsByCard.get(l.cardId) ?? []
    arr.push({ id: l.clientId, name: l.clientName })
    clientsByCard.set(l.cardId, arr)
  }

  const usersByCard = new Map<string, CardUserRef[]>()
  for (const l of userLinks) {
    const arr = usersByCard.get(l.cardId) ?? []
    arr.push({ id: l.userId, name: l.userName, email: l.userEmail })
    usersByCard.set(l.cardId, arr)
  }

  const contactsByCard = new Map<string, CardContactRef[]>()
  for (const l of contactLinks) {
    const arr = contactsByCard.get(l.cardId) ?? []
    arr.push({ id: l.contactId, name: l.contactName, clientId: l.contactClientId })
    contactsByCard.set(l.cardId, arr)
  }

  return cardRows.map((r) => ({
    id: r.card.id,
    organizationId: r.card.organizationId,
    priority: r.card.priority,
    category: r.card.category,
    message: normaliseMessage(r.card.message),
    accepted: r.card.accepted,
    rejectionReason: r.card.rejectionReason,
    sourceItemId: r.card.sourceItemId,
    sourceItemTitle: r.sourceItemFilename ?? r.sourceItemExternalId,
    ruleId: r.card.ruleId,
    ruleName: r.ruleName,
    clients: clientsByCard.get(r.card.id) ?? [],
    users: usersByCard.get(r.card.id) ?? [],
    contacts: contactsByCard.get(r.card.id) ?? [],
    createdAt: r.card.createdAt.toISOString(),
    updatedAt: r.card.updatedAt.toISOString(),
  }))
}

export async function getCard(cardId: string): Promise<CardRow | null> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({
      card,
      ruleName: rule.name,
      sourceItemFilename: sourceItem.filename,
      sourceItemExternalId: sourceItem.externalId,
    })
    .from(card)
    .leftJoin(rule, eq(card.ruleId, rule.id))
    .leftJoin(sourceItem, eq(card.sourceItemId, sourceItem.id))
    .where(eq(card.id, cardId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  // Tenant scope: a card from another org reads as not-found rather than
  // forbidden so existence isn't leaked.
  if (row.card.organizationId !== activeOrgId) return null

  const [clientLinks, userLinks, contactLinks] = await Promise.all([
    db
      .select({
        clientId: client.id,
        clientName: client.name,
      })
      .from(cardClient)
      .innerJoin(client, eq(cardClient.clientId, client.id))
      .where(eq(cardClient.cardId, cardId)),
    db
      .select({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
      })
      .from(cardUser)
      .innerJoin(user, eq(cardUser.userId, user.id))
      .where(eq(cardUser.cardId, cardId)),
    db
      .select({
        contactId: contact.id,
        contactName: contact.name,
        contactClientId: contact.clientId,
      })
      .from(cardContact)
      .innerJoin(contact, eq(cardContact.contactId, contact.id))
      .where(eq(cardContact.cardId, cardId)),
  ])

  return {
    id: row.card.id,
    organizationId: row.card.organizationId,
    priority: row.card.priority,
    category: row.card.category,
    message: normaliseMessage(row.card.message),
    accepted: row.card.accepted,
    rejectionReason: row.card.rejectionReason,
    sourceItemId: row.card.sourceItemId,
    sourceItemTitle: row.sourceItemFilename ?? row.sourceItemExternalId,
    ruleId: row.card.ruleId,
    ruleName: row.ruleName,
    clients: clientLinks.map((l) => ({ id: l.clientId, name: l.clientName })),
    users: userLinks.map((l) => ({
      id: l.userId,
      name: l.userName,
      email: l.userEmail,
    })),
    contacts: contactLinks.map((l) => ({
      id: l.contactId,
      name: l.contactName,
      clientId: l.contactClientId,
    })),
    createdAt: row.card.createdAt.toISOString(),
    updatedAt: row.card.updatedAt.toISOString(),
  }
}

export async function createCard(data: {
  priority?: CardPriority
  category: CardCategory
  message: CardMessage
  sourceItemId?: string | null
  ruleId?: string | null
  clientIds?: string[]
  userIds?: string[]
  contactIds?: string[]
}) {
  const { activeOrgId } = await requireOrgContext()
  if (!data.category) throw new Error("Category is required")

  const message = normaliseMessage(data.message)
  await assertSourceItemIfProvided(data.sourceItemId, activeOrgId)
  await assertRuleIfProvided(data.ruleId, activeOrgId)
  const clientIds = data.clientIds ?? []
  const userIds = data.userIds ?? []
  const contactIds = data.contactIds ?? []
  await assertClientIdsInOrg(clientIds, activeOrgId)
  await assertUserIdsInOrg(userIds, activeOrgId)
  await assertContactIdsInOrg(contactIds, activeOrgId)

  const id = randomUUID()
  await db.insert(card).values({
    id,
    organizationId: activeOrgId,
    priority: data.priority ?? "normal",
    category: data.category,
    message,
    sourceItemId: data.sourceItemId || null,
    ruleId: data.ruleId || null,
  })
  if (clientIds.length > 0) {
    await db
      .insert(cardClient)
      .values(clientIds.map((clientId) => ({ cardId: id, clientId })))
  }
  if (userIds.length > 0) {
    await db
      .insert(cardUser)
      .values(userIds.map((userId) => ({ cardId: id, userId })))
  }
  if (contactIds.length > 0) {
    await db
      .insert(cardContact)
      .values(contactIds.map((contactId) => ({ cardId: id, contactId })))
  }
  return { id }
}

export async function updateCard(
  cardId: string,
  data: {
    priority?: CardPriority
    category?: CardCategory
    message?: CardMessage
    sourceItemId?: string | null
    ruleId?: string | null
    clientIds?: string[]
    userIds?: string[]
    contactIds?: string[]
  },
) {
  const { activeOrgId } = await requireOrgContext()
  await assertCardInOrg(cardId, activeOrgId)

  if (data.sourceItemId !== undefined) {
    await assertSourceItemIfProvided(data.sourceItemId, activeOrgId)
  }
  if (data.ruleId !== undefined) {
    await assertRuleIfProvided(data.ruleId, activeOrgId)
  }
  if (data.clientIds !== undefined) {
    await assertClientIdsInOrg(data.clientIds, activeOrgId)
  }
  if (data.userIds !== undefined) {
    await assertUserIdsInOrg(data.userIds, activeOrgId)
  }
  if (data.contactIds !== undefined) {
    await assertContactIdsInOrg(data.contactIds, activeOrgId)
  }

  await db
    .update(card)
    .set({
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.message !== undefined
        ? { message: normaliseMessage(data.message) }
        : {}),
      ...(data.sourceItemId !== undefined
        ? { sourceItemId: data.sourceItemId || null }
        : {}),
      ...(data.ruleId !== undefined
        ? { ruleId: data.ruleId || null }
        : {}),
    })
    .where(eq(card.id, cardId))

  if (data.clientIds !== undefined) {
    await db.delete(cardClient).where(eq(cardClient.cardId, cardId))
    if (data.clientIds.length > 0) {
      await db
        .insert(cardClient)
        .values(data.clientIds.map((clientId) => ({ cardId, clientId })))
    }
  }
  if (data.userIds !== undefined) {
    await db.delete(cardUser).where(eq(cardUser.cardId, cardId))
    if (data.userIds.length > 0) {
      await db
        .insert(cardUser)
        .values(data.userIds.map((userId) => ({ cardId, userId })))
    }
  }
  if (data.contactIds !== undefined) {
    await db.delete(cardContact).where(eq(cardContact.cardId, cardId))
    if (data.contactIds.length > 0) {
      await db
        .insert(cardContact)
        .values(data.contactIds.map((contactId) => ({ cardId, contactId })))
    }
  }
}

export async function acceptCard(cardId: string) {
  const { activeOrgId } = await requireOrgContext()
  await assertCardInOrg(cardId, activeOrgId)
  await db
    .update(card)
    .set({ accepted: true, rejectionReason: null })
    .where(eq(card.id, cardId))
}

export async function rejectCard(cardId: string, reason: string) {
  const { activeOrgId } = await requireOrgContext()
  await assertCardInOrg(cardId, activeOrgId)
  const trimmed = reason?.trim() ?? ""
  if (!trimmed) throw new Error("Rejection reason is required")
  await db
    .update(card)
    .set({ accepted: false, rejectionReason: trimmed })
    .where(eq(card.id, cardId))
}

export async function deleteCard(cardId: string) {
  const { activeOrgId } = await requireOrgContext()
  await assertCardInOrg(cardId, activeOrgId)
  await db.delete(card).where(eq(card.id, cardId))
}
