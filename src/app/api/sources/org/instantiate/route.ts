import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { db } from "@/db/drizzle"
import { member, sourceTemplate } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { instantiateFromTemplate } from "@/server/templates"

// Org-owner endpoint for the "Add source" picker.
// Body: { templateId }
//
// Auth model:
//   - 401 if no session / no active org
//   - 403 if caller is not the owner of their active org
//   - 400 if templateId is missing or template is not visible to orgs
//   - 404 if template doesn't exist or is inactive
//
// The instantiated source row lands with template defaults: empty
// providerConfig, null credentialsRef. The owner finishes setup via
// the existing Edit-config + Configure-credentials dialogs on the
// "Manage organization sources" tab.
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) {
    return NextResponse.json(
      { error: "No active organization on session" },
      { status: 401 },
    )
  }

  // Owner check (mirrors `requireOrgOwner` in src/server/sources.ts but
  // inlined here so we only need one auth import in this thin route).
  const memberRows = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, activeOrgId),
      ),
    )
    .limit(1)
  if (!memberRows[0]) {
    return NextResponse.json({ error: "Not a member of active org" }, { status: 401 })
  }
  if (memberRows[0].role !== "owner") {
    return NextResponse.json(
      { error: "Only the org owner can add sources" },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const templateId = typeof b.templateId === "string" ? b.templateId : null
  if (!templateId) {
    return NextResponse.json(
      { error: "templateId is required" },
      { status: 400 },
    )
  }

  // Verify the template is visible to orgs before instantiating.
  // `instantiateFromTemplate` already checks active status, but it
  // doesn't enforce `is_visible_to_orgs` — that's a UI-policy guard
  // (admin-internal templates shouldn't be reachable via this route).
  const tpl = await db
    .select({
      id: sourceTemplate.id,
      isVisibleToOrgs: sourceTemplate.isVisibleToOrgs,
      status: sourceTemplate.status,
    })
    .from(sourceTemplate)
    .where(eq(sourceTemplate.id, templateId))
    .limit(1)
  if (!tpl[0]) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }
  if (tpl[0].status !== "active") {
    return NextResponse.json({ error: "Template is inactive" }, { status: 404 })
  }
  if (!tpl[0].isVisibleToOrgs) {
    return NextResponse.json(
      { error: "Template not available to org owners" },
      { status: 403 },
    )
  }

  try {
    const result = await instantiateFromTemplate({
      organizationId: activeOrgId,
      templateId,
      createdByUserId: session.user.id,
      // Always create — clicking Add a second time intentionally
      // creates a second instance (e.g. multiple Drive folders pointing
      // at different driveIds on the same template).
      idempotent: false,
    })
    return NextResponse.json({ id: result.id, created: result.created }, { status: 201 })
  } catch (error) {
    console.error("[sources/org/instantiate] Error:", error)
    const message = error instanceof Error ? error.message : "Request failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Convenience: surface the instantiable template list. The org-owner
// "Add source" dialog calls this to populate the picker — same data as
// the admin route but filtered to status='active' AND
// is_visible_to_orgs=true. Auth: any signed-in member of an active org.
export async function GET() {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!session.session.activeOrganizationId) {
    return NextResponse.json(
      { error: "No active organization on session" },
      { status: 401 },
    )
  }
  const { listInstantiableTemplates } = await import("@/server/templates")
  try {
    const templates = await listInstantiableTemplates()
    return NextResponse.json({ templates })
  } catch (error) {
    console.error("[sources/org/instantiate GET] Error:", error)
    const message = error instanceof Error ? error.message : "Request failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
