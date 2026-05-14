import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"
import { updateAdminSourceCredentials } from "@/server/admin-sources"

// Admin-only credentials update. Body: `{ sourceId, credentials }`.
// Mirrors the owner-side flow at /api/sources/org/credentials but skips
// the org-ownership check — admin can edit any source's credentials.
//
// Errors mirror the owner route (400 / 401 / 403 / 404 / 500).
// `requireAdmin()` inside the server fn throws on non-admin; the catch
// arm here surfaces it as 401/403 based on the message. Keep the
// admin auth contract simple: a non-admin sees a generic 401.
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
    await updateAdminSourceCredentials(sourceId, b.credentials)
    return NextResponse.json({ ok: true })
  } catch (error) {
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
    if (error instanceof Error) {
      const msg = error.message
      // requireAdmin throws "Unauthorized" / "Forbidden — not an admin".
      if (msg === "Unauthorized") {
        return NextResponse.json({ error: msg }, { status: 401 })
      }
      if (msg.includes("admin")) {
        return NextResponse.json({ error: msg }, { status: 403 })
      }
      if (msg.startsWith("Source not found")) {
        return NextResponse.json({ error: msg }, { status: 404 })
      }
      console.error("[admin/sources/credentials] Error:", error)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    console.error("[admin/sources/credentials] Unknown error:", error)
    return NextResponse.json({ error: "Request failed" }, { status: 500 })
  }
}
