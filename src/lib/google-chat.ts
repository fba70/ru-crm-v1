import "server-only"
import { google } from "googleapis"
import { getGoogleAuth, parseServiceAccountJson } from "@/lib/google-auth"
import type { GchatCredentials } from "@/server/providers/handlers"

const APP_SCOPES = [
  "https://www.googleapis.com/auth/chat.bot",
  "https://www.googleapis.com/auth/chat.app.messages.readonly",
  // Added so we can list channel members for the parser's `recipients`
  // field. If DWD doesn't have this scope authorised the listChatMembers()
  // helper fails gracefully and returns an empty list.
  "https://www.googleapis.com/auth/chat.memberships.readonly",
]

export function getChatClient(creds: GchatCredentials) {
  const auth = getGoogleAuth(
    parseServiceAccountJson(creds.serviceAccountJson),
    APP_SCOPES,
  )
  return google.chat({ version: "v1", auth })
}

/**
 * List human member displayNames of a Chat space. Best-effort:
 *   - Excludes bots (`member.type === "BOT"`) — they're not real recipients.
 *   - Skips members with no displayName (rare, but Google sometimes returns
 *     stripped User objects for external participants).
 *   - Returns `[]` on *any* error (missing scope, revoked auth, transient
 *     failure). The parser's `recipients` field is allowed to be empty per
 *     the template, so callers should treat this as non-critical.
 */
export async function listChatMembers(
  creds: GchatCredentials,
  spaceName: string,
): Promise<string[]> {
  try {
    const chat = getChatClient(creds)
    const out: string[] = []
    let pageToken: string | undefined
    do {
      const response = await chat.spaces.members.list({
        parent: spaceName,
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      })
      for (const membership of response.data.memberships ?? []) {
        const user = membership.member
        if (!user) continue
        if (user.type && user.type !== "HUMAN") continue
        const name = user.displayName?.trim()
        if (name) out.push(name)
      }
      pageToken = response.data.nextPageToken ?? undefined
    } while (pageToken)
    return out
  } catch (error) {
    console.warn(
      "[google-chat] listChatMembers failed — returning empty list:",
      error instanceof Error ? error.message : error,
    )
    return []
  }
}

/**
 * Download a Chat attachment's bytes server-side via domain-wide delegation
 * impersonation. Used by both the browser-facing `/api/chats/attachments`
 * proxy and the chat parser's attachment dispatcher.
 *
 * We hit the media endpoint directly (rather than via `chat.media.download()`)
 * because the googleapis client wrapper doesn't reliably include `alt=media`,
 * which the Chat media API requires for binary download; without it Google
 * returns 400. Direct fetch also surfaces Google's real error body in logs.
 */
export async function downloadChatAttachmentBytes(
  creds: GchatCredentials,
  resourceName: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const auth = getGoogleAuth(
    parseServiceAccountJson(creds.serviceAccountJson),
    ["https://www.googleapis.com/auth/chat.messages.readonly"],
    creds.impersonateUser,
  )
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken =
    typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token
  if (!accessToken) throw new Error("Failed to obtain access token")

  // Preserve slashes in the resource path — encodeURIComponent would mangle them.
  const url = `https://chat.googleapis.com/v1/media/${resourceName
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")}?alt=media`

  const upstream = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!upstream.ok) {
    const body = await upstream.text()
    throw new Error(
      `Google Chat media error ${upstream.status}: ${body.slice(0, 500)}`,
    )
  }

  const buffer = await upstream.arrayBuffer()
  return new Uint8Array(buffer)
}
