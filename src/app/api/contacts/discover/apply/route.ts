import { NextRequest, NextResponse } from "next/server"
import {
  applyDiscoveredContacts,
  type ApplyContactDiscoveryInput,
} from "@/server/contacts"

export { type ApplyContactDiscoveryResult } from "@/server/contacts"

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
    const body = (await request.json()) as Partial<ApplyContactDiscoveryInput>
    if (
      !Array.isArray(body.selectedEmails) ||
      !Array.isArray(body.candidates) ||
      !Array.isArray(body.scannedRowIds)
    ) {
      return NextResponse.json(
        {
          error:
            "selectedEmails, candidates, and scannedRowIds are required",
        },
        { status: 400 },
      )
    }
    const result = await applyDiscoveredContacts({
      selectedEmails: body.selectedEmails,
      candidates: body.candidates,
      scannedRowIds: body.scannedRowIds,
      nameOverrides: body.nameOverrides,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
