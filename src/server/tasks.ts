"use server"

import { db } from "@/db/drizzle"
import {
  task,
  client,
  contact,
  deal,
  user,
  member,
  type TaskType,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema"
import { aliasedTable, and, eq, desc, inArray } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"

export type TaskRow = {
  id: string
  name: string
  description: string | null
  type: TaskType
  priority: TaskPriority
  status: TaskStatus
  userId: string
  userName: string | null
  assigneeId: string
  assigneeName: string | null
  clientId: string | null
  clientName: string | null
  contactId: string | null
  contactName: string | null
  dealId: string | null
  dealName: string | null
  organizationId: string
  dueDate: string
  createdAt: string
  updatedAt: string
}

export type OrgMemberOption = { id: string; name: string; email: string }
export type TaskClientOption = { id: string; name: string }
export type TaskContactOption = {
  id: string
  name: string
  clientId: string | null
}
export type TaskDealOption = {
  id: string
  name: string
  clientId: string
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertTaskInOrg(taskId: string, organizationId: string) {
  const existing = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1)
  const current = existing[0]
  if (!current) throw new Error("Task not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

async function assertUserInOrg(userId: string, organizationId: string) {
  const rows = await db
    .select()
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1)
  if (!rows[0]) throw new Error("Assignee is not a member of this organization")
}

async function assertClientIfProvided(
  clientId: string | null | undefined,
  organizationId: string,
) {
  if (!clientId) return
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

async function assertContactIfProvided(
  contactId: string | null | undefined,
  organizationId: string,
  clientId: string | null | undefined,
) {
  if (!contactId) return
  const rows = await db
    .select()
    .from(contact)
    .where(eq(contact.id, contactId))
    .limit(1)
  const current = rows[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid contact")
  }
  if (clientId && current.clientId && current.clientId !== clientId) {
    throw new Error("Contact does not belong to the selected client")
  }
}

async function assertDealIfProvided(
  dealId: string | null | undefined,
  organizationId: string,
) {
  if (!dealId) return
  const rows = await db
    .select()
    .from(deal)
    .where(eq(deal.id, dealId))
    .limit(1)
  const current = rows[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid deal")
  }
}

export async function listTasks(): Promise<TaskRow[]> {
  const { activeOrgId } = await requireOrgContext()

  const creator = aliasedTable(user, "task_creator")
  const assignee = aliasedTable(user, "task_assignee")

  const rows = await db
    .select({
      task,
      userName: creator.name,
      assigneeName: assignee.name,
      clientName: client.name,
      contactName: contact.name,
      dealName: deal.name,
    })
    .from(task)
    .leftJoin(creator, eq(task.userId, creator.id))
    .leftJoin(assignee, eq(task.assigneeId, assignee.id))
    .leftJoin(client, eq(task.clientId, client.id))
    .leftJoin(contact, eq(task.contactId, contact.id))
    .leftJoin(deal, eq(task.dealId, deal.id))
    .where(eq(task.organizationId, activeOrgId))
    .orderBy(desc(task.updatedAt))

  return rows.map((r) => ({
    id: r.task.id,
    name: r.task.name,
    description: r.task.description,
    type: r.task.type,
    priority: r.task.priority,
    status: r.task.status,
    userId: r.task.userId,
    userName: r.userName,
    assigneeId: r.task.assigneeId,
    assigneeName: r.assigneeName,
    clientId: r.task.clientId,
    clientName: r.clientName,
    contactId: r.task.contactId,
    contactName: r.contactName,
    dealId: r.task.dealId,
    dealName: r.dealName,
    organizationId: r.task.organizationId,
    dueDate: r.task.dueDate.toISOString(),
    createdAt: r.task.createdAt.toISOString(),
    updatedAt: r.task.updatedAt.toISOString(),
  }))
}

export async function listOrgMembers(): Promise<OrgMemberOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, activeOrgId))
    .orderBy(user.name)
  return rows
}

export async function listTaskClientOptions(): Promise<TaskClientOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        // active + initial: auto-discovered (initial) clients are valid task
        // targets too — mirrors the deal pickers, and lets a card's
        // identified client prefill stick even before it's reviewed.
        inArray(client.status, ["active", "initial"]),
      ),
    )
    .orderBy(client.name)
  return rows
}

export async function listTaskContactOptions(
  clientId?: string | null,
): Promise<TaskContactOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const conditions = [
    eq(contact.organizationId, activeOrgId),
    // active + initial, same rationale as listTaskClientOptions — so a card's
    // identified (often auto-discovered) contact prefill survives the form's
    // option-validity check.
    inArray(contact.status, ["active", "initial"]),
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

export async function listTaskDealOptions(
  clientId?: string | null,
): Promise<TaskDealOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const conditions = [
    eq(deal.organizationId, activeOrgId),
    // Only active deals are valid task contexts — cancelled / deleted deals
    // are soft-deleted and shouldn't appear in the picker.
    eq(deal.status, "active"),
  ]
  if (clientId) {
    conditions.push(eq(deal.clientId, clientId))
  }
  const rows = await db
    .select({
      id: deal.id,
      name: deal.name,
      clientId: deal.clientId,
    })
    .from(deal)
    .where(and(...conditions))
    .orderBy(deal.name)
  return rows
}

export async function createTask(data: {
  name: string
  description?: string | null
  type?: TaskType
  priority?: TaskPriority
  status?: TaskStatus
  assigneeId?: string | null
  clientId?: string | null
  contactId?: string | null
  dealId?: string | null
  dueDate?: string | null
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.name?.trim()) throw new Error("Name is required")

  const assigneeId = data.assigneeId || session.user.id
  await assertUserInOrg(assigneeId, activeOrgId)
  await assertClientIfProvided(data.clientId, activeOrgId)
  await assertContactIfProvided(data.contactId, activeOrgId, data.clientId)
  await assertDealIfProvided(data.dealId, activeOrgId)

  const now = new Date()
  const due = data.dueDate ? new Date(data.dueDate) : now
  if (Number.isNaN(due.getTime())) throw new Error("Invalid due date")

  const id = randomUUID()
  await db.insert(task).values({
    id,
    name: data.name.trim(),
    description: data.description?.trim() || null,
    type: data.type ?? "other",
    priority: data.priority ?? "medium",
    status: data.status ?? "todo",
    userId: session.user.id,
    assigneeId,
    clientId: data.clientId || null,
    contactId: data.contactId || null,
    dealId: data.dealId || null,
    organizationId: activeOrgId,
    dueDate: due,
    createdAt: now,
    updatedAt: now,
  })
  return { id }
}

export async function updateTask(
  taskId: string,
  data: {
    name?: string
    description?: string | null
    type?: TaskType
    priority?: TaskPriority
    status?: TaskStatus
    assigneeId?: string | null
    clientId?: string | null
    contactId?: string | null
    dealId?: string | null
    dueDate?: string | null
  },
) {
  const { activeOrgId } = await requireOrgContext()
  const current = await assertTaskInOrg(taskId, activeOrgId)

  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name is required")
  }
  if (data.assigneeId) {
    await assertUserInOrg(data.assigneeId, activeOrgId)
  }
  if (data.clientId !== undefined) {
    await assertClientIfProvided(data.clientId, activeOrgId)
  }
  if (data.contactId !== undefined) {
    const effectiveClientId =
      data.clientId !== undefined ? data.clientId : current.clientId
    await assertContactIfProvided(data.contactId, activeOrgId, effectiveClientId)
  }
  if (data.dealId !== undefined) {
    await assertDealIfProvided(data.dealId, activeOrgId)
  }

  let due: Date | undefined
  if (data.dueDate !== undefined) {
    if (!data.dueDate) throw new Error("Invalid due date")
    const parsed = new Date(data.dueDate)
    if (Number.isNaN(parsed.getTime())) throw new Error("Invalid due date")
    due = parsed
  }

  await db
    .update(task)
    .set({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined
        ? { description: data.description?.trim() || null }
        : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.assigneeId ? { assigneeId: data.assigneeId } : {}),
      ...(data.clientId !== undefined
        ? { clientId: data.clientId || null }
        : {}),
      ...(data.contactId !== undefined
        ? { contactId: data.contactId || null }
        : {}),
      ...(data.dealId !== undefined ? { dealId: data.dealId || null } : {}),
      ...(due ? { dueDate: due } : {}),
    })
    .where(eq(task.id, taskId))
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const { activeOrgId } = await requireOrgContext()
  await assertTaskInOrg(taskId, activeOrgId)
  await db.update(task).set({ status }).where(eq(task.id, taskId))
}
