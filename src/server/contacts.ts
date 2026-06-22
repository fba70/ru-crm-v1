"use server"

import { db } from "@/db/drizzle"
import { contact, client, user, type EntityStatus } from "@/db/schema"
import { and, eq, desc, inArray } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"

export type ContactRow = {
  id: string
  name: string
  nameNative: string | null
  aliases: string[] | null
  phone: string | null
  email: string | null
  position: string | null
  clientId: string | null
  clientName: string | null
  status: EntityStatus
  userId: string
  userName: string | null
  organizationId: string
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

async function assertContactInOrg(contactId: string, organizationId: string) {
  const existing = await db
    .select()
    .from(contact)
    .where(eq(contact.id, contactId))
    .limit(1)
  const current = existing[0]
  if (!current) throw new Error("Contact not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

async function assertClientIfProvided(
  clientId: string | null | undefined,
  organizationId: string,
) {
  if (!clientId) return
  const existing = await db
    .select()
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const current = existing[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid client")
  }
}

export async function listContacts(): Promise<ContactRow[]> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await db
    .select({
      contact,
      userName: user.name,
      clientName: client.name,
    })
    .from(contact)
    .leftJoin(user, eq(contact.userId, user.id))
    .leftJoin(client, eq(contact.clientId, client.id))
    .where(eq(contact.organizationId, activeOrgId))
    .orderBy(desc(contact.updatedAt))

  return rows.map((r) => ({
    id: r.contact.id,
    name: r.contact.name,
    nameNative: r.contact.nameNative,
    aliases: r.contact.aliases,
    phone: r.contact.phone,
    email: r.contact.email,
    position: r.contact.position,
    clientId: r.contact.clientId,
    clientName: r.clientName,
    status: r.contact.status,
    userId: r.contact.userId,
    userName: r.userName,
    organizationId: r.contact.organizationId,
    createdAt: r.contact.createdAt.toISOString(),
    updatedAt: r.contact.updatedAt.toISOString(),
  }))
}

export type ClientOption = { id: string; name: string }

export async function listClientOptions(): Promise<ClientOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        // Include `initial` (New) clients, not just `active` — otherwise a
        // contact linked to a freshly-discovered New company has no matching
        // <SelectItem> in the edit dialog, so the selector renders empty and
        // the existing link looks absent. Matches the `["active","initial"]`
        // convention used by deals/orders/tasks selectors.
        inArray(client.status, ["active", "initial"]),
      ),
    )
    .orderBy(client.name)
  return rows
}

/** Trim, drop empties + dups; return null for an empty list. */
function cleanAliases(raw: string[] | null | undefined): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const a of raw) {
    const t = (typeof a === "string" ? a : "").trim()
    if (!t) continue
    const lower = t.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(t)
  }
  return out.length > 0 ? out : null
}

export async function createContact(data: {
  name: string
  nameNative?: string | null
  aliases?: string[] | null
  phone?: string | null
  email?: string | null
  position?: string | null
  clientId?: string | null
  status?: EntityStatus
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.name?.trim()) throw new Error("Name is required")

  await assertClientIfProvided(data.clientId, activeOrgId)

  const id = randomUUID()
  const now = new Date()
  await db.insert(contact).values({
    id,
    name: data.name.trim(),
    nameNative: data.nameNative?.trim() || null,
    aliases: cleanAliases(data.aliases),
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    position: data.position?.trim() || null,
    clientId: data.clientId || null,
    status: data.status ?? "active",
    userId: session.user.id,
    organizationId: activeOrgId,
    createdAt: now,
    updatedAt: now,
  })
  return { id }
}

export async function updateContact(
  contactId: string,
  data: {
    name?: string
    nameNative?: string | null
    aliases?: string[] | null
    phone?: string | null
    email?: string | null
    position?: string | null
    clientId?: string | null
    status?: EntityStatus
  },
) {
  const { activeOrgId } = await requireOrgContext()
  await assertContactInOrg(contactId, activeOrgId)

  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name is required")
  }
  if (data.clientId !== undefined) {
    await assertClientIfProvided(data.clientId, activeOrgId)
  }

  await db
    .update(contact)
    .set({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.nameNative !== undefined
        ? { nameNative: data.nameNative?.trim() || null }
        : {}),
      ...(data.aliases !== undefined
        ? { aliases: cleanAliases(data.aliases) }
        : {}),
      ...(data.phone !== undefined
        ? { phone: data.phone?.trim() || null }
        : {}),
      ...(data.email !== undefined
        ? { email: data.email?.trim() || null }
        : {}),
      ...(data.position !== undefined
        ? { position: data.position?.trim() || null }
        : {}),
      ...(data.clientId !== undefined
        ? { clientId: data.clientId || null }
        : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    })
    .where(eq(contact.id, contactId))
}
