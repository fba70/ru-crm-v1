import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"
import {
  updateOwnerOrgSourceProviderConfig,
  OrgOwnerError,
  SourceScopeError,
} from "@/server/sources"

// Owner-only `provider_config` update. Body: `{ sourceId, providerConfig }`.
//
// Validated server-side against the per-provider zod schema declared in
// `src/server/providers/handlers.ts`. Read-write (unlike credentials):
// provider config is non-secret, so the form pre-fills + replaces.
//
// Errors:
//   401 — no session / no active org / not a member of active org
//   403 — caller is not the owner OR source is not in this org's scope
//   404 — sourceId doesn't exist
//   400 — bad body OR provider has no providerConfigSchema OR zod payload
//         validation failed (issues returned in `issues` for the form)
export async function PATCH(request: NextRequest) {
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

  const sourceId = typeof b.sourceId === "string" ? b.sourceId : null
  if (!sourceId) {
    return NextResponse.json(
      { error: "sourceId is required" },
      { status: 400 },
    )
  }
  if (b.providerConfig === undefined || b.providerConfig === null) {
    return NextResponse.json(
      { error: "providerConfig payload is required" },
      { status: 400 },
    )
  }

  try {
    await updateOwnerOrgSourceProviderConfig(sourceId, b.providerConfig)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof OrgOwnerError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "unauthorized" ? 401 : 403 },
      )
    }
    if (error instanceof SourceScopeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 403 },
      )
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "providerConfig payload failed validation",
          issues: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      )
    }
    console.error("[sources/org/config] Error:", error)
    const message =
      error instanceof Error ? error.message : "Request failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
