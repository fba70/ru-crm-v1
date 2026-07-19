import { NextResponse } from "next/server"
import { resolveEnrichment } from "@/server/clients"

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

// Apply a human's pick (or dismiss) for a parked client. No new web call —
// replays the candidates stored during the batch.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const choice =
      body?.skip === true
        ? ({ skip: true } as const)
        : typeof body?.candidateIndex === "number"
          ? ({ candidateIndex: body.candidateIndex } as const)
          : null
    if (!choice) {
      return NextResponse.json(
        { error: "candidateIndex or skip is required" },
        { status: 400 },
      )
    }
    const result = await resolveEnrichment(id, choice)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
