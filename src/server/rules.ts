"use server"

import { db } from "@/db/drizzle"
import { rule, user, organization, type RuleType } from "@/db/schema"
import { and, eq, ilike, desc } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"

export type RuleRow = {
  id: string
  name: string
  content: string
  type: RuleType
  userId: string
  userName: string | null
  organizationId: string
  organizationName: string | null
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

async function requireSession() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  return session
}

function isPlatformAdmin(role: string | null | undefined) {
  return role === "admin"
}

async function mapRows(
  rows: Array<{
    rule: typeof rule.$inferSelect
    userName: string | null
    organizationName: string | null
  }>,
): Promise<RuleRow[]> {
  return rows.map((r) => ({
    id: r.rule.id,
    name: r.rule.name,
    content: r.rule.content,
    type: r.rule.type,
    userId: r.rule.userId,
    userName: r.userName,
    organizationId: r.rule.organizationId,
    organizationName: r.organizationName,
    isDeleted: r.rule.isDeleted,
    createdAt: r.rule.createdAt.toISOString(),
    updatedAt: r.rule.updatedAt.toISOString(),
  }))
}

async function listRules(filters: {
  type: RuleType
  search?: string
  organizationId?: string | null
}): Promise<RuleRow[]> {
  const conditions = [
    eq(rule.type, filters.type),
    eq(rule.isDeleted, false),
  ]
  if (filters.search) {
    conditions.push(ilike(rule.name, `%${filters.search}%`))
  }
  if (filters.organizationId) {
    conditions.push(eq(rule.organizationId, filters.organizationId))
  }

  const rows = await db
    .select({
      rule,
      userName: user.name,
      organizationName: organization.name,
    })
    .from(rule)
    .leftJoin(user, eq(rule.userId, user.id))
    .leftJoin(organization, eq(rule.organizationId, organization.id))
    .where(and(...conditions))
    .orderBy(desc(rule.updatedAt))

  return mapRows(rows)
}

export async function getSystemRules(search?: string): Promise<RuleRow[]> {
  await requireSession()
  return listRules({ type: "System", search })
}

export async function getCustomRules(
  search?: string,
  organizationFilter?: string,
): Promise<RuleRow[]> {
  const session = await requireSession()
  const admin = isPlatformAdmin(session.user.role)

  if (admin) {
    return listRules({
      type: "Custom",
      search,
      organizationId: organizationFilter || null,
    })
  }

  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) return []
  return listRules({ type: "Custom", search, organizationId: activeOrgId })
}

export async function createRule(data: {
  name: string
  content: string
  type: RuleType
}) {
  const session = await requireSession()
  const admin = isPlatformAdmin(session.user.role)

  if (data.type === "System" && !admin) {
    throw new Error("Only platform admins can create system rules")
  }

  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) {
    throw new Error("No active organization")
  }

  const now = new Date()
  const id = randomUUID()
  await db.insert(rule).values({
    id,
    name: data.name,
    content: data.content,
    type: data.type,
    userId: session.user.id,
    organizationId: activeOrgId,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  })
  return { id }
}

async function authorizeMutation(ruleId: string) {
  const session = await requireSession()
  const admin = isPlatformAdmin(session.user.role)

  const existing = await db
    .select()
    .from(rule)
    .where(eq(rule.id, ruleId))
    .limit(1)
  const current = existing[0]
  if (!current) throw new Error("Rule not found")

  if (current.type === "System") {
    if (!admin) throw new Error("Unauthorized")
  } else {
    const activeOrgId = session.session.activeOrganizationId
    if (!admin && current.organizationId !== activeOrgId) {
      throw new Error("Unauthorized")
    }
  }
  return current
}

export async function updateRule(
  ruleId: string,
  data: { name?: string; content?: string },
) {
  await authorizeMutation(ruleId)
  await db
    .update(rule)
    .set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
    })
    .where(eq(rule.id, ruleId))
}

export async function softDeleteRule(ruleId: string) {
  await authorizeMutation(ruleId)
  await db.update(rule).set({ isDeleted: true }).where(eq(rule.id, ruleId))
}
