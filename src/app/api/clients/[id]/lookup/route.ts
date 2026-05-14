import { NextResponse } from "next/server"
import { lookupClientOnWeb } from "@/server/clients"

export {
  type ClientLookupCandidate,
  type ClientLookupResult,
  type ClientLookupSource,
} from "@/server/clients"

// Allow up to 60s — the two-pass Gemini call can take 8-15s typically
// but grounded search has occasional long tails.
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
    const result = await lookupClientOnWeb(id)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
