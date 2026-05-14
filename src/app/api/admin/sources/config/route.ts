import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"
import { updateAdminSourceProviderConfig } from "@/server/admin-sources"

// Admin-only `provider_config` update. Body: `{ sourceId, providerConfig }`.
// Mirrors the owner-side flow at /api/sources/org/config but skips the
// org-ownership check — admin can edit any source's provider config.
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
    await updateAdminSourceProviderConfig(sourceId, b.providerConfig)
    return NextResponse.json({ ok: true })
  } catch (error) {
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
    if (error instanceof Error) {
      const msg = error.message
      if (msg === "Unauthorized") {
        return NextResponse.json({ error: msg }, { status: 401 })
      }
      if (msg.includes("admin")) {
        return NextResponse.json({ error: msg }, { status: 403 })
      }
      if (msg.startsWith("Source not found")) {
        return NextResponse.json({ error: msg }, { status: 404 })
      }
      console.error("[admin/sources/config] Error:", error)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    console.error("[admin/sources/config] Unknown error:", error)
    return NextResponse.json({ error: "Request failed" }, { status: 500 })
  }
}
