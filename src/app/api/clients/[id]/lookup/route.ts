import { NextResponse } from "next/server"
import { lookupClientOnWeb, type ClientLookupHints } from "@/server/clients"

export {
  type ClientLookupCandidate,
  type ClientLookupResult,
  type ClientLookupSource,
  type ClientLookupHints,
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

// Only the five writable string fields are accepted as hints — anything else
// in the body is ignored, so the model's search parameters can never be widened
// from the browser.
function readHints(body: unknown): ClientLookupHints | undefined {
  if (!body || typeof body !== "object") return undefined
  const raw = (body as { hints?: unknown }).hints
  if (!raw || typeof raw !== "object") return undefined
  const src = raw as Record<string, unknown>
  const pick = (k: string) => (typeof src[k] === "string" ? (src[k] as string) : undefined)
  const hints: ClientLookupHints = {
    name: pick("name"),
    email: pick("email"),
    phone: pick("phone"),
    address: pick("address"),
    webUrl: pick("webUrl"),
  }
  return Object.values(hints).some((v) => (v ?? "").trim()) ? hints : undefined
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    // The batch enrichment posts no body at all — an unparseable body just
    // means "search from the stored record".
    let hints: ClientLookupHints | undefined
    try {
      hints = readHints(await request.json())
    } catch {
      hints = undefined
    }
    const result = await lookupClientOnWeb(id, hints)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
