import { NextResponse } from "next/server"
import { previewContactClientLinks } from "@/server/contacts"

export {
  type ContactLinkProposal,
  type ContactLinkPreview,
} from "@/server/contacts"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

export async function POST() {
  try {
    const preview = await previewContactClientLinks()
    return NextResponse.json(preview)
  } catch (error) {
    return errorResponse(error)
  }
}
