"use server"

import { db } from "@/db/drizzle"
import {
  client,
  contact,
  deal,
  card,
  notificationReadState,
  type CardCategory,
} from "@/db/schema"
import { and, count, desc, eq, gt, inArray } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

// Same rendering language the dashboard cards + cards-feed-section already
// use (duplicated there too — a small enum→label map, not worth a shared
// module for four lines).
const CARD_CATEGORY_LABEL: Record<CardCategory, string> = {
  client_activity: "Активность клиента",
  colleagues_activity: "Активность коллег",
  business_info: "Бизнес-информация",
  action_required: "Требуется действие",
  ambiguity: "Неоднозначность",
  data_intelligence: "Аналитика данных",
  momentum: "Динамика",
  log_only: "Только запись",
  new_order: "Новый заказ",
  support: "Поддержка",
}

export type NotificationEvent = {
  id: string
  type: "client" | "contact" | "deal" | "card"
  title: string
  subtitle: string | null
  createdAt: string
  href: string
}

const LIST_LIMIT = 20
// Per-type cap when building the merged list — generous enough that a busy
// org's single most-active type can't crowd the other three out of the
// merged/sorted top LIST_LIMIT.
const PER_TYPE_CAP = 15
// A viewer who has never opened the bell gets this lookback instead of the
// org's entire history — matches the "Утренние карточки" convention
// (though that page's OWN default was moved to "Все время" on the 18.09
// call; the notification bell is a different surface — a running badge, not
// an operator-set filter — so a bounded default here is still correct).
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000

async function resolveSince(organizationId: string, userId: string) {
  const [row] = await db
    .select({ lastSeenAt: notificationReadState.lastSeenAt })
    .from(notificationReadState)
    .where(
      and(
        eq(notificationReadState.organizationId, organizationId),
        eq(notificationReadState.userId, userId),
      ),
    )
    .limit(1)
  return row?.lastSeenAt ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS)
}

/** Recent org activity (new companies/contacts/deals/cards), newest first,
 *  plus how many of those are unread — the sidebar bell's data source.
 *  Derived from existing created_at columns, not a separate event log (see
 *  the schema comment on notificationReadState). */
export async function listNotifications() {
  const { activeOrgId, session } = await requireOrgContext()
  const userId = session.user.id
  const since = await resolveSince(activeOrgId, userId)

  const [clients, contacts, deals, cards, unreadCounts] = await Promise.all([
    db
      .select({ id: client.id, name: client.name, createdAt: client.createdAt })
      .from(client)
      .where(
        and(
          eq(client.organizationId, activeOrgId),
          inArray(client.status, ["active", "initial", "suspended"]),
        ),
      )
      .orderBy(desc(client.createdAt))
      .limit(PER_TYPE_CAP),
    db
      .select({ id: contact.id, name: contact.name, createdAt: contact.createdAt })
      .from(contact)
      .where(
        and(
          eq(contact.organizationId, activeOrgId),
          inArray(contact.status, ["active", "initial", "suspended"]),
        ),
      )
      .orderBy(desc(contact.createdAt))
      .limit(PER_TYPE_CAP),
    db
      .select({ id: deal.id, name: deal.name, createdAt: deal.createdAt })
      .from(deal)
      .where(and(eq(deal.organizationId, activeOrgId), eq(deal.status, "active")))
      .orderBy(desc(deal.createdAt))
      .limit(PER_TYPE_CAP),
    db
      .select({
        id: card.id,
        category: card.category,
        message: card.message,
        createdAt: card.createdAt,
      })
      .from(card)
      .where(eq(card.organizationId, activeOrgId))
      .orderBy(desc(card.createdAt))
      .limit(PER_TYPE_CAP),
    Promise.all([
      db
        .select({ n: count() })
        .from(client)
        .where(and(eq(client.organizationId, activeOrgId), gt(client.createdAt, since))),
      db
        .select({ n: count() })
        .from(contact)
        .where(and(eq(contact.organizationId, activeOrgId), gt(contact.createdAt, since))),
      db
        .select({ n: count() })
        .from(deal)
        .where(
          and(
            eq(deal.organizationId, activeOrgId),
            eq(deal.status, "active"),
            gt(deal.createdAt, since),
          ),
        ),
      db
        .select({ n: count() })
        .from(card)
        .where(and(eq(card.organizationId, activeOrgId), gt(card.createdAt, since))),
    ]),
  ])

  const events: NotificationEvent[] = [
    ...clients.map((c) => ({
      id: `client:${c.id}`,
      type: "client" as const,
      title: `Новая компания: ${c.name}`,
      subtitle: null,
      createdAt: c.createdAt.toISOString(),
      href: `/clients?openClient=${c.id}`,
    })),
    ...contacts.map((c) => ({
      id: `contact:${c.id}`,
      type: "contact" as const,
      title: `Новый контакт: ${c.name}`,
      subtitle: null,
      createdAt: c.createdAt.toISOString(),
      href: `/contacts?openContact=${c.id}`,
    })),
    ...deals.map((d) => ({
      id: `deal:${d.id}`,
      type: "deal" as const,
      title: `Новая сделка: ${d.name}`,
      subtitle: null,
      createdAt: d.createdAt.toISOString(),
      href: `/deals?openDeal=${d.id}`,
    })),
    ...cards.map((c) => {
      const msg = (c.message ?? {}) as { analysis?: string }
      return {
        id: `card:${c.id}`,
        type: "card" as const,
        title: `Новая карточка: ${CARD_CATEGORY_LABEL[c.category] ?? c.category}`,
        subtitle: msg.analysis ?? null,
        createdAt: c.createdAt.toISOString(),
        href: `/cards/${c.id}`,
      }
    }),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, LIST_LIMIT)

  const unreadCount = unreadCounts.reduce((sum, [row]) => sum + (row?.n ?? 0), 0)

  return { events, unreadCount, sinceIso: since.toISOString() }
}

/** Bumps the caller's watermark to now — clears the bell badge. Called when
 *  the notifications drawer is opened. */
export async function markNotificationsSeen() {
  const { activeOrgId, session } = await requireOrgContext()
  const userId = session.user.id
  await db
    .insert(notificationReadState)
    .values({ organizationId: activeOrgId, userId, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: [notificationReadState.organizationId, notificationReadState.userId],
      set: { lastSeenAt: new Date() },
    })
}
