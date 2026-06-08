import { createAuthClient } from "better-auth/react"
import {
  organizationClient,
  adminClient,
  emailOTPClient,
  inferOrgAdditionalFields,
} from "better-auth/client/plugins"
import { apiKeyClient } from "@better-auth/api-key/client"
import { polarClient } from "@polar-sh/better-auth"
import type { auth } from "@/lib/auth"

const baseUrl =
  typeof window !== "undefined"
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

export const authClient = createAuthClient({
  baseURL: baseUrl,
  plugins: [
    polarClient(),
    organizationClient({
      schema: inferOrgAdditionalFields<typeof auth>(),
    }),
    adminClient(),
    apiKeyClient(),
    emailOTPClient(),
  ],
})
