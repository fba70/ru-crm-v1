import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  saveChatSession,
  type ChatFileInput,
  type ChatMessageInput,
} from "@/server/save-chat-session"

export { type SaveChatSessionResult } from "@/server/save-chat-session"

// Save runs an LLM analysis pass + optional per-file parsing — file
// attachments (especially videos) can take a while. 60s gives headroom.
export const maxDuration = 60

// Hard cap on total upload size to keep the multipart parse + LLM call
// from blowing memory. Per-file parser caps in
// `src/lib/parser-config.ts` apply on top of this.
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

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
    const session = await getServerSession()
    if (!session) throw new Error("Unauthorized")
    const orgId = session.session.activeOrganizationId
    if (!orgId) throw new Error("No active organization")

    const form = await request.formData()
    const messagesJson = form.get("messages")
    const title = form.get("title")
    if (typeof messagesJson !== "string" || typeof title !== "string") {
      return NextResponse.json(
        { error: "messages (JSON string) and title are required" },
        { status: 400 },
      )
    }

    let messages: ChatMessageInput[]
    try {
      const parsed = JSON.parse(messagesJson)
      if (!Array.isArray(parsed)) throw new Error("messages must be an array")
      messages = parsed.filter(
        (m): m is ChatMessageInput =>
          m &&
          typeof m === "object" &&
          (m.role === "user" || m.role === "assistant" || m.role === "system") &&
          typeof m.text === "string",
      )
    } catch (err) {
      return NextResponse.json(
        {
          error: `Failed to parse messages JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 400 },
      )
    }

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "No messages to save" },
        { status: 400 },
      )
    }

    // Files arrive as repeated `files` form parts. Their order matches
    // the order the client extracted them from message parts; child
    // source_items get incrementing externalIds in this order so a
    // re-save of the same session is deterministic.
    const formFiles = form.getAll("files").filter((f): f is File => f instanceof File)
    let totalBytes = 0
    const files: ChatFileInput[] = []
    for (const f of formFiles) {
      const buffer = await f.arrayBuffer()
      totalBytes += buffer.byteLength
      if (totalBytes > MAX_TOTAL_BYTES) {
        return NextResponse.json(
          {
            error: `Total attachment size exceeds ${Math.round(
              MAX_TOTAL_BYTES / 1024 / 1024,
            )} MB cap. Drop some attachments and re-save.`,
          },
          { status: 400 },
        )
      }
      files.push({
        fileName: f.name,
        bytes: new Uint8Array(buffer),
        mediaType: f.type || "",
      })
    }

    const result = await saveChatSession({
      organizationId: orgId,
      userId: session.user.id,
      title,
      messages,
      files,
    })

    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
