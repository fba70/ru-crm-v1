import { NextRequest, NextResponse } from "next/server"
import {
  applyContactClientLinks,
  type ApplyContactClientLinksInput,
} from "@/server/contacts"

export { type ApplyContactClientLinksResult } from "@/server/contacts"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<ApplyContactClientLinksInput>
    if (!Array.isArray(body.links)) {
      return NextResponse.json(
        { error: "links is required" },
        { status: 400 },
      )
    }
    const result = await applyContactClientLinks({ links: body.links })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
