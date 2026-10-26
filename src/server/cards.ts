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
  source,
  sourceItem,
  user,
  type CardPriority,
  type CardCategory,
} from "@/db/schema"
import { and, desc, eq, inArray, notInArray } from "drizzle-orm"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
  isFreemailDomain,
} from "@/lib/email-domain"
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
  // What accepting this card actually created — set by acceptCard() when the
  // caller passes resultTaskId/resultOrderId. At most one is ever non-null.
  resultTaskId: string | null
  resultOrderId: string | null
  sourceItemId: string | null
  // Human-readable description of the source the card was built from: email
  // subject / first line of a chat message / file name. Never the provider's
  // opaque external id (that read as a meaningless hash on the card).
  sourceItemTitle: string | null
  sourceProvider: string | null
  sourceSender: string | null
  // Email To + Cc, formatted for display (null for chats/files).
  sourceRecipients: string | null
  sourceCreatedAt: string | null
  ruleId: string | null
  ruleName: string | null
  clients: CardClientRef[]
  users: CardUserRef[]
  contacts: CardContactRef[]
  // Компания, о которой карточка — крупно в заголовке на Домашней. LLM
  // привязывает card_client далеко не всегда, поэтому резолвится цепочкой
  // (см. resolveCardCompanies); null — компанию определить не удалось.
  company: CardClientRef | null
  createdAt: string
  updatedAt: string
}

// Raw join columns describing a card's source item (see sourceSummary).
type SourceJoin = {
  sourceItemFilename: string | null
  sourceItemMetadata: unknown
  sourceItemCreatedAt: Date | null
  sourceProvider: string | null
}

const SOURCE_SELECT = {
  sourceItemFilename: sourceItem.filename,
  sourceItemMetadata: sourceItem.metadataJson,
  sourceItemCreatedAt: sourceItem.sourceCreatedAt,
  sourceProvider: source.provider,
}

function firstLine(text: unknown, max = 120): string | null {
  if (typeof text !== "string") return null
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return null
  return line.length > max ? line.slice(0, max - 1) + "…" : line
}

function formatParty(p: unknown): string | null {
  const f = p as { name?: unknown; email?: unknown }
  const name = typeof f?.name === "string" ? f.name.trim() : ""
  const email = typeof f?.email === "string" ? f.email.trim() : ""
  if (name && email) return `${name} <${email}>`
  return name || email || null
}

function formatParties(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list.map(formatParty).filter((p): p is string => !!p)
}

function firstSender(meta: Record<string, unknown>): string | null {
  const from = formatParties(meta.from)
  if (from.length > 0) return from[0]
  const senders = meta.senders
  if (Array.isArray(senders) && typeof senders[0] === "string") {
    return senders[0].trim() || null
  }
  return null
}

// Turns the joined source columns into what the card shows: a title the
// operator recognises (subject / message preview / file name), the sender and
// the original date. The opaque external id is deliberately never used.
function sourceSummary(r: SourceJoin) {
  const meta =
    r.sourceItemMetadata && typeof r.sourceItemMetadata === "object"
      ? (r.sourceItemMetadata as Record<string, unknown>)
      : {}
  const subject =
    typeof meta.subject === "string" && meta.subject.trim()
      ? meta.subject.trim()
      : null
  const title =
    subject ??
    firstLine(meta.text) ??
    firstLine(meta.rawText) ??
    r.sourceItemFilename ??
    firstLine(meta.summary)
  return {
    sourceItemTitle: title,
    sourceProvider: r.sourceProvider,
    sourceSender: firstSender(meta),
    sourceRecipients:
      [...formatParties(meta.to), ...formatParties(meta.cc)].join(", ") ||
      null,
    sourceCreatedAt: r.sourceItemCreatedAt
      ? r.sourceItemCreatedAt.toISOString()
      : null,
  }
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

// Email внешнего отправителя исходника: envelope `from` (почта), иначе
// канонические `participants` (gchat/gdrive). Telegram/файлы → null.
function senderEmailOf(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null
  const m = meta as Record<string, unknown>
  for (const list of [m.from, m.participants]) {
    if (!Array.isArray(list)) continue
    for (const p of list) {
      const e = (p as { email?: unknown })?.email
      if (typeof e === "string" && e.includes("@")) return e.trim().toLowerCase()
    }
  }
  return null
}

type CompanyInput = {
  cardId: string
  clients: CardClientRef[]
  contacts: CardContactRef[]
  senderEmail: string | null
}

// Компания карточки, по убыванию надёжности:
//   1. card_client (LLM сопоставил с ростером);
//   2. компания привязанного контакта (card_contact → contact.client_id);
//   3. контакт с email отправителя → его компания;
//   4. домен отправителя (не freemail) ↔ сайт или email-домен компании.
// Ни ФИО контакта, ни другие догадки сюда не идут: лучше пусто, чем
// человек вместо компании (звонок 26.10).
async function resolveCardCompanies(
  organizationId: string,
  inputs: CompanyInput[],
): Promise<Map<string, CardClientRef | null>> {
  const out = new Map<string, CardClientRef | null>()
  const needLookup = inputs.some((i) => i.clients.length === 0)
  const [orgClients, orgContacts] = needLookup
    ? await Promise.all([
        db
          .select({
            id: client.id,
            name: client.name,
            webUrl: client.webUrl,
            email: client.email,
          })
          .from(client)
          .where(
            and(
              eq(client.organizationId, organizationId),
              notInArray(client.status, ["deleted", "blocked"]),
            ),
          ),
        db
          .select({ email: contact.email, clientId: contact.clientId })
          .from(contact)
          .where(
            and(
              eq(contact.organizationId, organizationId),
              notInArray(contact.status, ["deleted", "blocked"]),
            ),
          ),
      ])
    : [[], []]

  const clientById = new Map(orgClients.map((c) => [c.id, c]))
  const clientIdByContactEmail = new Map<string, string>()
  for (const c of orgContacts) {
    if (c.email && c.clientId) {
      clientIdByContactEmail.set(c.email.trim().toLowerCase(), c.clientId)
    }
  }
  const ref = (id: string | null | undefined): CardClientRef | null => {
    const c = id ? clientById.get(id) : undefined
    return c ? { id: c.id, name: c.name } : null
  }
  const byDomain = (domain: string): CardClientRef | null => {
    if (!domain || isFreemailDomain(domain)) return null
    for (const c of orgClients) {
      const site = c.webUrl ? extractWebsiteDomain(c.webUrl) : ""
      const mail = c.email ? extractEmailDomain(c.email) : ""
      if (
        (site && domainMatches(domain, site)) ||
        (mail && !isFreemailDomain(mail) && mail === domain)
      ) {
        return { id: c.id, name: c.name }
      }
    }
    return null
  }

  for (const i of inputs) {
    let company: CardClientRef | null = i.clients[0] ?? null
    if (!company) {
      for (const ct of i.contacts) {
        company = ref(ct.clientId)
        if (company) break
      }
    }
    if (!company && i.senderEmail) {
      company =
        ref(clientIdByContactEmail.get(i.senderEmail)) ??
        byDomain(extractEmailDomain(i.senderEmail))
    }
    out.set(i.cardId, company)
  }
  return out
}

export async function listCards(): Promise<CardRow[]> {
  const { activeOrgId } = await requireOrgContext()

  const cardRows = await db
    .select({
      card,
      ruleName: rule.name,
      ...SOURCE_SELECT,
    })
    .from(card)
    .leftJoin(rule, eq(card.ruleId, rule.id))
    .leftJoin(sourceItem, eq(card.sourceItemId, sourceItem.id))
    .leftJoin(source, eq(sourceItem.sourceId, source.id))
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

  const companies = await resolveCardCompanies(
    activeOrgId,
    cardRows.map((r) => ({
      cardId: r.card.id,
      clients: clientsByCard.get(r.card.id) ?? [],
      contacts: contactsByCard.get(r.card.id) ?? [],
      senderEmail: senderEmailOf(r.sourceItemMetadata),
    })),
  )

  return cardRows.map((r) => ({
    id: r.card.id,
    organizationId: r.card.organizationId,
    priority: r.card.priority,
    category: r.card.category,
    message: normaliseMessage(r.card.message),
    accepted: r.card.accepted,
    rejectionReason: r.card.rejectionReason,
    resultTaskId: r.card.resultTaskId,
    resultOrderId: r.card.resultOrderId,
    sourceItemId: r.card.sourceItemId,
    ...sourceSummary(r),
    ruleId: r.card.ruleId,
    ruleName: r.ruleName,
    clients: clientsByCard.get(r.card.id) ?? [],
    users: usersByCard.get(r.card.id) ?? [],
    contacts: contactsByCard.get(r.card.id) ?? [],
    company: companies.get(r.card.id) ?? null,
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
      ...SOURCE_SELECT,
    })
    .from(card)
    .leftJoin(rule, eq(card.ruleId, rule.id))
    .leftJoin(sourceItem, eq(card.sourceItemId, sourceItem.id))
    .leftJoin(source, eq(sourceItem.sourceId, source.id))
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

  const clients = clientLinks.map((l) => ({
    id: l.clientId,
    name: l.clientName,
  }))
  const contacts = contactLinks.map((l) => ({
    id: l.contactId,
    name: l.contactName,
    clientId: l.contactClientId,
  }))
  const company =
    (
      await resolveCardCompanies(activeOrgId, [
        {
          cardId,
          clients,
          contacts,
          senderEmail: senderEmailOf(row.sourceItemMetadata),
        },
      ])
    ).get(cardId) ?? null

  return {
    id: row.card.id,
    organizationId: row.card.organizationId,
    priority: row.card.priority,
    category: row.card.category,
    message: normaliseMessage(row.card.message),
    accepted: row.card.accepted,
    rejectionReason: row.card.rejectionReason,
    resultTaskId: row.card.resultTaskId,
    resultOrderId: row.card.resultOrderId,
    sourceItemId: row.card.sourceItemId,
    ...sourceSummary(row),
    ruleId: row.card.ruleId,
    ruleName: row.ruleName,
    clients,
    users: userLinks.map((l) => ({
      id: l.userId,
      name: l.userName,
      email: l.userEmail,
    })),
    contacts,
    company,
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

export async function acceptCard(
  cardId: string,
  opts?: { resultTaskId?: string; resultOrderId?: string },
) {
  const { activeOrgId } = await requireOrgContext()
  await assertCardInOrg(cardId, activeOrgId)
  await db
    .update(card)
    .set({
      accepted: true,
      rejectionReason: null,
      ...(opts?.resultTaskId ? { resultTaskId: opts.resultTaskId } : {}),
      ...(opts?.resultOrderId ? { resultOrderId: opts.resultOrderId } : {}),
    })
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
