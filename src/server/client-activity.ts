import "server-only"

import { db } from "@/db/drizzle"
import {
  card,
  cardClient,
  cardContact,
  contact,
  deal,
  order,
  sourceItem,
  task,
} from "@/db/schema"
import { and, eq, inArray, isNotNull, max, sql } from "drizzle-orm"

// «Последняя активность» по компании — замена прокси `client.updatedAt` /
// `deal.updatedAt` в бейджах «N дн без активности/контакта» (звонок 26.10:
// по компании сегодня было письмо, а сделка показывала «69 дней»).
//
// Сигналы (берётся самый свежий):
//   • входящие коммуникации — карточки, привязанные к компании напрямую
//     (card_client) или через её контакт (card_contact → contact.client_id);
//     дата = время самого сообщения (source_item.source_created_at), а не
//     момент генерации карточки — карточку могли сгенерить сегодня по
//     старому письму; без источника — card.created_at;
//   • задачи компании (task.updated_at);
//   • сделки компании (deal.updated_at — переходы стадий, правки);
//   • заказы компании (order.updated_at);
//   • контакты компании (contact.updated_at — парсер дописывает их из писем).
// Org-скоуп — явным аргументом; вызывающий уже проверил сессию.
export async function loadClientLastActivity(
  organizationId: string,
  clientIds: string[],
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  const ids = [...new Set(clientIds)]
  if (ids.length === 0) return out

  const bump = (clientId: string | null, at: Date | string | null) => {
    if (!clientId || !at) return
    const d = at instanceof Date ? at : new Date(at)
    if (!Number.isFinite(d.getTime())) return
    const prev = out.get(clientId)
    if (!prev || d > prev) out.set(clientId, d)
  }

  // Время сообщения, из которого сделана карточка (или самой карточки).
  const cardAt = sql<string>`max(coalesce(${sourceItem.sourceCreatedAt}, ${card.createdAt}))`

  const [direct, viaContact, tasks, deals, orders, contacts] =
    await Promise.all([
      db
        .select({ clientId: cardClient.clientId, at: cardAt })
        .from(cardClient)
        .innerJoin(card, eq(cardClient.cardId, card.id))
        .leftJoin(sourceItem, eq(card.sourceItemId, sourceItem.id))
        .where(
          and(
            eq(card.organizationId, organizationId),
            inArray(cardClient.clientId, ids),
          ),
        )
        .groupBy(cardClient.clientId),
      db
        .select({ clientId: contact.clientId, at: cardAt })
        .from(cardContact)
        .innerJoin(contact, eq(cardContact.contactId, contact.id))
        .innerJoin(card, eq(cardContact.cardId, card.id))
        .leftJoin(sourceItem, eq(card.sourceItemId, sourceItem.id))
        .where(
          and(
            eq(card.organizationId, organizationId),
            inArray(contact.clientId, ids),
          ),
        )
        .groupBy(contact.clientId),
      db
        .select({ clientId: task.clientId, at: max(task.updatedAt) })
        .from(task)
        .where(
          and(
            eq(task.organizationId, organizationId),
            inArray(task.clientId, ids),
          ),
        )
        .groupBy(task.clientId),
      db
        .select({ clientId: deal.clientId, at: max(deal.updatedAt) })
        .from(deal)
        .where(
          and(
            eq(deal.organizationId, organizationId),
            inArray(deal.clientId, ids),
          ),
        )
        .groupBy(deal.clientId),
      db
        .select({ clientId: order.clientId, at: max(order.updatedAt) })
        .from(order)
        .where(
          and(
            eq(order.organizationId, organizationId),
            inArray(order.clientId, ids),
          ),
        )
        .groupBy(order.clientId),
      db
        .select({ clientId: contact.clientId, at: max(contact.updatedAt) })
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, organizationId),
            isNotNull(contact.clientId),
            inArray(contact.clientId, ids),
          ),
        )
        .groupBy(contact.clientId),
    ])

  for (const rows of [direct, viaContact, tasks, deals, orders, contacts]) {
    for (const r of rows) bump(r.clientId, r.at)
  }
  return out
}

// То же для сделок: max(сама сделка, её задачи, активность её компании).
export async function loadDealLastActivity(
  organizationId: string,
  deals: { id: string; clientId: string | null; updatedAt: string }[],
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  if (deals.length === 0) return out

  const dealIds = deals.map((d) => d.id)
  const [byClient, dealTasks] = await Promise.all([
    loadClientLastActivity(
      organizationId,
      deals.map((d) => d.clientId).filter((id): id is string => !!id),
    ),
    db
      .select({ dealId: task.dealId, at: max(task.updatedAt) })
      .from(task)
      .where(
        and(
          eq(task.organizationId, organizationId),
          inArray(task.dealId, dealIds),
        ),
      )
      .groupBy(task.dealId),
  ])
  const taskAt = new Map<string, Date>()
  for (const r of dealTasks) {
    if (r.dealId && r.at) taskAt.set(r.dealId, new Date(r.at))
  }

  for (const d of deals) {
    let latest = new Date(d.updatedAt)
    for (const c of [
      d.clientId ? byClient.get(d.clientId) : undefined,
      taskAt.get(d.id),
    ]) {
      if (c && c > latest) latest = c
    }
    out.set(d.id, latest)
  }
  return out
}
