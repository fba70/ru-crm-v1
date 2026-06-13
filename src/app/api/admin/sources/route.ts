import { NextRequest, NextResponse } from "next/server"
import {
  createAdminSource,
  listAdminSources,
  listOrgOptionsForAdmin,
  updateAdminSource,
  type AdminSourceInput,
} from "@/server/admin-sources"
import {
  sourceProvider,
  type SourceProvider,
  type SourceStatus,
  type SourceType,
} from "@/db/schema"

export { type AdminSource } from "@/server/admin-sources"

// Derived from the DB enum so it never drifts when a new provider is added
// (was a hardcoded subset that silently rejected newer providers).
const PROVIDERS: SourceProvider[] = [...sourceProvider.enumValues]
const TYPES: SourceType[] = ["external", "internal"]
const STATUSES: SourceStatus[] = ["active", "inactive"]

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    if (searchParams.get("orgOptions") === "1") {
      const organizations = await listOrgOptionsForAdmin()
      return NextResponse.json({ organizations })
    }

    const provider = searchParams.get("provider")
    const result = await listAdminSources({
      provider:
        provider && PROVIDERS.includes(provider as SourceProvider)
          ? (provider as SourceProvider)
          : null,
      searchName: searchParams.get("searchName") || undefined,
      showInactive: searchParams.get("showInactive") === "1",
      limit: parseInt(searchParams.get("limit") || "5", 10),
      offset: parseInt(searchParams.get("offset") || "0", 10),
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    console.error("[admin/sources] GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch sources" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const input = parseInput(body)
    const result = await createAdminSource(input)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return errorResponse(error, "Failed to create source")
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const sourceId =
      typeof body?.sourceId === "string" ? body.sourceId : undefined
    if (!sourceId) {
      return NextResponse.json(
        { error: "sourceId is required" },
        { status: 400 },
      )
    }
    const partial = parsePartialInput(body)
    await updateAdminSource(sourceId, partial)
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error, "Failed to update source")
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  const msg = error instanceof Error ? error.message : fallback
  console.error("[admin/sources]", error)
  return NextResponse.json({ error: msg }, { status: 400 })
}

function parseInput(body: unknown): AdminSourceInput {
  if (!body || typeof body !== "object") throw new Error("Invalid body")
  const b = body as Record<string, unknown>

  if (typeof b.name !== "string" || !b.name.trim()) {
    throw new Error("name is required")
  }
  if (
    typeof b.provider !== "string" ||
    !PROVIDERS.includes(b.provider as SourceProvider)
  ) {
    throw new Error("provider must be one of: " + PROVIDERS.join(", "))
  }
  const type =
    typeof b.type === "string" && TYPES.includes(b.type as SourceType)
      ? (b.type as SourceType)
      : "external"
  const status =
    typeof b.status === "string" &&
    STATUSES.includes(b.status as SourceStatus)
      ? (b.status as SourceStatus)
      : "active"
  const isSystem = b.isSystem === true
  const automatedParsingIsAllowed =
    typeof b.automatedParsingIsAllowed === "boolean"
      ? b.automatedParsingIsAllowed
      : true

  const providerConfig = parseJsonObject(b.providerConfig, "providerConfig")

  return {
    name: b.name,
    description: typeof b.description === "string" ? b.description : null,
    type,
    provider: b.provider as SourceProvider,
    isSystem,
    ownerOrganizationId:
      typeof b.ownerOrganizationId === "string"
        ? b.ownerOrganizationId
        : null,
    providerConfig: providerConfig ?? {},
    status,
    automatedParsingIsAllowed,
  }
}

function parsePartialInput(body: unknown): Partial<AdminSourceInput> {
  if (!body || typeof body !== "object") throw new Error("Invalid body")
  const b = body as Record<string, unknown>
  const out: Partial<AdminSourceInput> = {}

  if (typeof b.name === "string") out.name = b.name
  if (typeof b.description === "string" || b.description === null) {
    out.description = b.description as string | null
  }
  if (typeof b.type === "string" && TYPES.includes(b.type as SourceType)) {
    out.type = b.type as SourceType
  }
  if (
    typeof b.provider === "string" &&
    PROVIDERS.includes(b.provider as SourceProvider)
  ) {
    out.provider = b.provider as SourceProvider
  }
  if (
    typeof b.status === "string" &&
    STATUSES.includes(b.status as SourceStatus)
  ) {
    out.status = b.status as SourceStatus
  }
  if (typeof b.isSystem === "boolean") out.isSystem = b.isSystem
  if (
    typeof b.ownerOrganizationId === "string" ||
    b.ownerOrganizationId === null
  ) {
    out.ownerOrganizationId = b.ownerOrganizationId as string | null
  }
  if (b.providerConfig !== undefined) {
    out.providerConfig = parseJsonObject(b.providerConfig, "providerConfig")
  }
  if (typeof b.automatedParsingIsAllowed === "boolean") {
    out.automatedParsingIsAllowed = b.automatedParsingIsAllowed
  }
  return out
}

function parseJsonObject(
  raw: unknown,
  field: string,
): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (trimmed === "") return {}
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`${field} must be a JSON object`)
      }
      return parsed as Record<string, unknown>
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`${field} is not valid JSON: ${err.message}`)
      }
      throw err
    }
  }
  throw new Error(`${field} must be a JSON object or stringified JSON`)
}

