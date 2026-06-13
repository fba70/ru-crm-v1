import { NextRequest, NextResponse } from "next/server"
import {
  listAdminTemplates,
  createTemplate,
  type TemplateInput,
} from "@/server/templates"
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

// Admin-only template dictionary CRUD.
//   GET  ?showInactive=1 → list templates
//   POST                  → create a new template
// Per-row updates land on /api/admin/templates/[id] (PUT).
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const showInactive = searchParams.get("showInactive") === "1"
    const templates = await listAdminTemplates({ showInactive })
    return NextResponse.json({ templates })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = validateInput(body)
  if (parsed.kind === "invalid") {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  try {
    const result = await createTemplate(parsed.input)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

// Validates body for create. Updates have their own validator in
// /api/admin/templates/[id]/route.ts (allows partial fields).
function validateInput(
  body: unknown,
): { kind: "valid"; input: TemplateInput } | { kind: "invalid"; error: string } {
  if (!body || typeof body !== "object") {
    return { kind: "invalid", error: "Invalid body" }
  }
  const b = body as Record<string, unknown>
  if (typeof b.name !== "string" || !b.name.trim()) {
    return { kind: "invalid", error: "name is required" }
  }
  if (typeof b.provider !== "string" || !PROVIDERS.includes(b.provider as SourceProvider)) {
    return { kind: "invalid", error: "provider is invalid" }
  }
  if (typeof b.type !== "string" || !TYPES.includes(b.type as SourceType)) {
    return { kind: "invalid", error: "type is invalid" }
  }
  if (
    b.status !== undefined &&
    (typeof b.status !== "string" || !STATUSES.includes(b.status as SourceStatus))
  ) {
    return { kind: "invalid", error: "status is invalid" }
  }
  return {
    kind: "valid",
    input: {
      name: b.name,
      type: b.type as SourceType,
      provider: b.provider as SourceProvider,
      description: typeof b.description === "string" ? b.description : null,
      defaultProviderConfig:
        b.defaultProviderConfig && typeof b.defaultProviderConfig === "object"
          ? (b.defaultProviderConfig as Record<string, unknown>)
          : {},
      defaultAutomatedParsingIsAllowed:
        typeof b.defaultAutomatedParsingIsAllowed === "boolean"
          ? b.defaultAutomatedParsingIsAllowed
          : true,
      isDefault: typeof b.isDefault === "boolean" ? b.isDefault : false,
      isVisibleToOrgs:
        typeof b.isVisibleToOrgs === "boolean" ? b.isVisibleToOrgs : true,
      status: (b.status as SourceStatus | undefined) ?? "active",
    },
  }
}

function errorResponse(error: unknown) {
  if (error instanceof Error) {
    const msg = error.message
    if (msg === "Unauthorized") {
      return NextResponse.json({ error: msg }, { status: 401 })
    }
    if (msg.includes("admin")) {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    console.error("[admin/templates] Error:", error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
  console.error("[admin/templates] Unknown error:", error)
  return NextResponse.json({ error: "Request failed" }, { status: 500 })
}
