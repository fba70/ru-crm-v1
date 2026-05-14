import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"
import {
  updateOwnerOrgSourceCredentials,
  OrgOwnerError,
  SourceScopeError,
} from "@/server/sources"

// Owner-only credentials update. Body: `{ sourceId, credentials }`.
//
// `credentials` is the plaintext payload — the server validates against
// the provider's zod schema, encrypts with the per-source AES-GCM key,
// and writes to `source.credentials_ref`. Plaintext is never returned;
// the matching GET surface (the org-sources list) only exposes the
// boolean `credentialsConfigured`.
//
// Errors:
//   401 — no session / no active org / not a member of active org
//   403 — caller is not the owner OR source is not in this org's scope
//   404 — sourceId doesn't exist
//   400 — bad body OR provider has no credentials schema OR zod payload
//         validation failed (issues returned in `issues` for the form)
export async function PUT(request: NextRequest) {
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
  if (b.credentials === undefined || b.credentials === null) {
    return NextResponse.json(
      { error: "credentials payload is required" },
      { status: 400 },
    )
  }

  try {
    await updateOwnerOrgSourceCredentials(sourceId, b.credentials)
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
          error: "Credentials payload failed validation",
          issues: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      )
    }
    console.error("[sources/org/credentials] Error:", error)
    const message =
      error instanceof Error ? error.message : "Request failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
