import { google } from "googleapis"
import { getGoogleAuth, parseServiceAccountJson } from "@/lib/google-auth"
import type { GdriveCredentials } from "@/server/providers/handlers"

export function getDriveClient(creds: GdriveCredentials) {
  const auth = getGoogleAuth(parseServiceAccountJson(creds.serviceAccountJson), [
    "https://www.googleapis.com/auth/drive.readonly",
  ])
  return google.drive({ version: "v3", auth })
}
