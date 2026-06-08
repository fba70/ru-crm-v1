"use server"

import { db } from "@/db/drizzle"
import { organization, member, user } from "@/db/schema"
import { eq, count, and, like } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"

export type AdminOrg = {
  id: string
  name: string
  slug: string
  logo: string | null
  webUrl: string | null
  address: string | null
  email: string | null
  phone: string | null
  metadata: string | null
  createdAt: string
  memberCount: number
  ownerName: string | null
  ownerEmail: string | null
}

export type UserOrgInfo = {
  memberId: string
  organizationId: string
  organizationName: string
  orgRole: string
}

async function requireAdmin() {
  const session = await getServerSession()
  if (!session || session.user.role !== "admin") {
    throw new Error("Unauthorized")
  }
  return session
}

export async function getAdminOrganizations(
  searchName: string,
  limit: number,
  offset: number,
) {
  await requireAdmin()

  const whereClause = searchName
    ? like(organization.name, `%${searchName}%`)
    : undefined

  const orgs = await db
    .select()
    .from(organization)
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(organization.createdAt)

  const totalResult = await db
    .select({ count: count() })
    .from(organization)
    .where(whereClause)

  const total = totalResult[0]?.count ?? 0

  const result: AdminOrg[] = await Promise.all(
    orgs.map(async (org) => {
      const memberCount = await db
        .select({ count: count() })
        .from(member)
        .where(eq(member.organizationId, org.id))

      const owner = await db
        .select({
          userName: user.name,
          userEmail: user.email,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.organizationId, org.id),
            eq(member.role, "owner"),
          ),
        )
        .limit(1)

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        webUrl: org.webUrl,
        address: org.address,
        email: org.email,
        phone: org.phone,
        metadata: org.metadata,
        createdAt: org.createdAt.toISOString(),
        memberCount: memberCount[0]?.count ?? 0,
        ownerName: owner[0]?.userName ?? null,
        ownerEmail: owner[0]?.userEmail ?? null,
      }
    }),
  )

  return { organizations: result, total }
}

export async function updateAdminOrganization(
  organizationId: string,
  data: {
    name?: string
    slug?: string
    logo?: string
    taxId?: string
    webUrl?: string
    address?: string
    email?: string
    phone?: string
  },
) {
  await requireAdmin()

  const metadata = JSON.stringify({ taxId: data.taxId || "" })

  await db
    .update(organization)
    .set({
      name: data.name,
      slug: data.slug,
      logo: data.logo,
      metadata,
      webUrl: data.webUrl?.trim() || null,
      address: data.address?.trim() || null,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
    })
    .where(eq(organization.id, organizationId))
}

export async function getAdminUserOrganizations() {
  await requireAdmin()

  const members = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      orgRole: member.role,
      organizationId: member.organizationId,
      organizationName: organization.name,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))

  const userOrgMap: Record<string, string> = {}
  const userOrgDetails: Record<string, UserOrgInfo[]> = {}

  for (const m of members) {
    if (userOrgMap[m.userId]) {
      userOrgMap[m.userId] += `, ${m.organizationName}`
    } else {
      userOrgMap[m.userId] = m.organizationName
    }

    if (!userOrgDetails[m.userId]) {
      userOrgDetails[m.userId] = []
    }
    userOrgDetails[m.userId].push({
      memberId: m.memberId,
      organizationId: m.organizationId,
      organizationName: m.organizationName,
      orgRole: m.orgRole,
    })
  }

  return { userOrgMap, userOrgDetails }
}
