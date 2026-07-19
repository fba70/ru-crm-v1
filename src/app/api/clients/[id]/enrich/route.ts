import { NextResponse } from "next/server"
import { enrichClientFromWeb } from "@/server/clients"

export { type EnrichClientResult } from "@/server/clients"

// One client per request — fits the ~55s two-pass grounded-Gemini budget.
// The browser loop POSTs one of these per pending client, so no single
// request runs long enough to time out.
export const maxDuration = 60

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message === "Client not found"
        ? 404
        : 400
  return NextResponse.json({ error: message }, { status })
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const result = await enrichClientFromWeb(id)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
