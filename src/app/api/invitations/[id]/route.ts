import { NextResponse } from "next/server"
import { getInvitationForAcceptance } from "@/server/invitations"

export { type PublicInvitation } from "@/server/invitations"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const data = await getInvitationForAcceptance(id)
    if (!data) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 },
      )
    }
    return NextResponse.json({ invitation: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
