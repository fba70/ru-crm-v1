import { NextRequest, NextResponse } from "next/server"
import { hasPendingInvitationForEmail } from "@/server/invitations"

export async function GET(request: NextRequest) {
  try {
    const email = new URL(request.url).searchParams.get("email")
    if (!email) {
      return NextResponse.json(
        { error: "email is required" },
        { status: 400 },
      )
    }
    const hasPending = await hasPendingInvitationForEmail(email)
    return NextResponse.json({ hasPending })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
