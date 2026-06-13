import { NextRequest, NextResponse } from "next/server"
import { updateTemplate, type TemplateInput } from "@/server/templates"
import {
  sourceProvider,
  type SourceProvider,
  type SourceStatus,
  type SourceType,
} from "@/db/schema"

// Derived from the DB enum so a new provider never silently fails validation.
const PROVIDERS: SourceProvider[] = [...sourceProvider.enumValues]
const TYPES: SourceType[] = ["external", "internal"]
const STATUSES: SourceStatus[] = ["active", "inactive"]

// Admin-only per-template updates. PATCH-shaped (all fields optional)
// but uses PUT method for symmetry with /api/admin/sources/[id].
//
// Hard-deletion isn't supported by design — templates soft-delete via
// `status = 'inactive'`. Pass `status: "inactive"` to retire one.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "Missing template id" }, { status: 400 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = validatePatch(body)
  if (parsed.kind === "invalid") {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  try {
    await updateTemplate(id, parsed.patch)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message
      if (msg === "Unauthorized") {
        return NextResponse.json({ error: msg }, { status: 401 })
      }
      if (msg.includes("admin")) {
        return NextResponse.json({ error: msg }, { status: 403 })
      }
      console.error("[admin/templates/:id] Error:", error)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    return NextResponse.json({ error: "Request failed" }, { status: 500 })
  }
}

function validatePatch(
  body: unknown,
):
  | { kind: "valid"; patch: Partial<TemplateInput> }
  | { kind: "invalid"; error: string } {
  if (!body || typeof body !== "object") {
    return { kind: "invalid", error: "Invalid body" }
  }
  const b = body as Record<string, unknown>
  const patch: Partial<TemplateInput> = {}
  if (b.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim()) {
      return { kind: "invalid", error: "name must be a non-empty string" }
    }
    patch.name = b.name
  }
  if (b.description !== undefined) {
    if (b.description !== null && typeof b.description !== "string") {
      return { kind: "invalid", error: "description must be string or null" }
    }
    patch.description = b.description as string | null
  }
  if (b.provider !== undefined) {
    if (typeof b.provider !== "string" || !PROVIDERS.includes(b.provider as SourceProvider)) {
      return { kind: "invalid", error: "provider is invalid" }
    }
    patch.provider = b.provider as SourceProvider
  }
  if (b.type !== undefined) {
    if (typeof b.type !== "string" || !TYPES.includes(b.type as SourceType)) {
      return { kind: "invalid", error: "type is invalid" }
    }
    patch.type = b.type as SourceType
  }
  if (b.defaultProviderConfig !== undefined) {
    if (!b.defaultProviderConfig || typeof b.defaultProviderConfig !== "object") {
      return { kind: "invalid", error: "defaultProviderConfig must be an object" }
    }
    patch.defaultProviderConfig = b.defaultProviderConfig as Record<string, unknown>
  }
  if (b.defaultAutomatedParsingIsAllowed !== undefined) {
    if (typeof b.defaultAutomatedParsingIsAllowed !== "boolean") {
      return { kind: "invalid", error: "defaultAutomatedParsingIsAllowed must be boolean" }
    }
    patch.defaultAutomatedParsingIsAllowed = b.defaultAutomatedParsingIsAllowed
  }
  if (b.isDefault !== undefined) {
    if (typeof b.isDefault !== "boolean") {
      return { kind: "invalid", error: "isDefault must be boolean" }
    }
    patch.isDefault = b.isDefault
  }
  if (b.isVisibleToOrgs !== undefined) {
    if (typeof b.isVisibleToOrgs !== "boolean") {
      return { kind: "invalid", error: "isVisibleToOrgs must be boolean" }
    }
    patch.isVisibleToOrgs = b.isVisibleToOrgs
  }
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !STATUSES.includes(b.status as SourceStatus)) {
      return { kind: "invalid", error: "status is invalid" }
    }
    patch.status = b.status as SourceStatus
  }
  return { kind: "valid", patch }
}
