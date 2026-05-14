"use server"

import { db } from "@/db/drizzle"
import { invitation, organization } from "@/db/schema"
import { and, eq, gt } from "drizzle-orm"

export type PublicInvitation = {
  id: string
  email: string
  organizationId: string
  organizationName: string | null
  status: string
  expiresAt: string
  expired: boolean
}

/**
 * Public lookup of an invitation by its (unguessable) ID. Used by the
 * accept-invitation page to show an invited user their own email / org name
 * BEFORE they have a session — better-auth's own `getInvitation` requires
 * authentication, which creates a chicken-and-egg for a brand new user.
 *
 * Returns null if the invitation does not exist. Minimal fields only — no
 * inviter email, no roles, no internal IDs beyond what the caller already has.
 */
export async function getInvitationForAcceptance(
  invitationId: string,
): Promise<PublicInvitation | null> {
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .leftJoin(organization, eq(organization.id, invitation.organizationId))
    .where(eq(invitation.id, invitationId))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    email: row.email,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() < Date.now(),
  }
}

/**
 * Returns true if the given email has at least one pending (non-expired)
 * invitation. Used by the sign-up form to warn users off creating a
 * standalone account when they should be clicking their invite link.
 *
 * Returns only a boolean — no invitation details are exposed, so this does
 * not leak which org sent the invite, who the inviter is, or the link.
 */
export async function hasPendingInvitationForEmail(
  email: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false
  const rows = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.email, normalized),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return rows.length > 0
}
