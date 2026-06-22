import { auth } from "@/lib/auth"
import { db } from "@/db/drizzle"
import {
  session as sessionTable,
  member,
  organization,
} from "@/db/schema"
import { eq } from "drizzle-orm"
import { headers } from "next/headers"
import { cache } from "react"

// chache() deduplicates repeated calls for the session, for example, from the header and the page

export const getServerSession = cache(async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  if (!session) return session

  // Backfill activeOrganization* on the session if missing.
  //
  // The `session.create.before` hook in src/lib/auth.ts only fires at
  // sign-in time, so a user who joined an org AFTER their session was
  // created (e.g. a platform admin who was added as a member by another
  // admin without going through the invitation flow) keeps a session
  // row with activeOrganizationId = null forever. That leaks into the
  // sidebar ("No organization") and breaks every server-side check
  // that reads `session.session.activeOrganizationId`.
  //
  // Fix: lazily look up the user's first membership and persist it
  // back to the session row. Idempotent; runs once per affected
  // session and the write makes subsequent reads cheap.
  if (!session.session.activeOrganizationId) {
    const firstMember = await db
      .select({ orgId: member.organizationId })
      .from(member)
      .where(eq(member.userId, session.user.id))
      .limit(1)
    const orgId = firstMember[0]?.orgId
    if (orgId) {
      const orgRow = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1)
      const org = orgRow[0]
      if (org) {
        // NOTE: the org logo is deliberately NOT written to the session.
        // It's a base64 data URL (often 100KB+) and `cookieCache` would
        // serialise it into the session cookie → 431 Request Header Fields
        // Too Large. The sidebar loads the logo server-side instead.
        await db
          .update(sessionTable)
          .set({
            activeOrganizationId: org.id,
            activeOrganizationName: org.name,
            activeOrganizationSlug: org.slug,
          })
          .where(eq(sessionTable.id, session.session.id))
        // Decorate the in-flight return so the current request sees
        // the org without waiting for the next read. Better-auth's
        // `additionalFields` types these as `string`, but the DB
        // columns are nullable; we mirror the nullable shape at
        // runtime via `Object.assign` (avoids per-key TS narrowing).
        Object.assign(session.session, {
          activeOrganizationId: org.id,
          activeOrganizationName: org.name,
          activeOrganizationSlug: org.slug,
        })
      }
    }
  }

  return session
})
