import { NextResponse } from "next/server"
import { listEnrichReview } from "@/server/clients"

export { type EnrichReviewRow } from "@/server/clients"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

// The manual disambiguation queue (status='review') for the review dialog.
export async function GET() {
  try {
    const rows = await listEnrichReview()
    return NextResponse.json({ rows })
  } catch (error) {
    return errorResponse(error)
  }
}
