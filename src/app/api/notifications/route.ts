import { NextResponse } from "next/server"
import { listNotifications, markNotificationsSeen } from "@/server/notifications"

export async function GET() {
  try {
    const data = await listNotifications()
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load notifications"
    const status = message === "Unauthorized" || message === "No active organization" ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

// Marks everything up to now as seen for the caller — called when the
// notifications drawer is opened.
export async function POST() {
  try {
    await markNotificationsSeen()
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update notifications"
    const status = message === "Unauthorized" || message === "No active organization" ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
