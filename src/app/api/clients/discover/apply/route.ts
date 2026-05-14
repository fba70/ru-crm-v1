import { NextRequest, NextResponse } from "next/server"
import {
  applyDiscoveredClients,
  type ApplyDiscoveryInput,
} from "@/server/clients"

export { type ApplyDiscoveryResult } from "@/server/clients"

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
    const body = (await request.json()) as Partial<ApplyDiscoveryInput>
    if (!Array.isArray(body.selectedKeys) || !Array.isArray(body.candidates)) {
      return NextResponse.json(
        { error: "selectedKeys and candidates are required" },
        { status: 400 },
      )
    }
    const result = await applyDiscoveredClients({
      selectedKeys: body.selectedKeys,
      candidates: body.candidates,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
