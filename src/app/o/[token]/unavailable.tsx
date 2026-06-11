import { PackageX } from "lucide-react"
import type { ResolveFailReason } from "@/server/order-links"

const COPY: Record<ResolveFailReason, { title: string; body: string }> = {
  not_found: {
    title: "Link not found",
    body: "This order link is invalid or no longer exists.",
  },
  revoked: {
    title: "Link no longer active",
    body: "This order link has been revoked. Please contact the sender for an up-to-date link.",
  },
  expired: {
    title: "Link expired",
    body: "This order link has expired. Please contact the sender for a new one.",
  },
}

export function LinkUnavailable({ reason }: { reason: ResolveFailReason }) {
  const c = COPY[reason]
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md text-center space-y-3">
        <PackageX className="h-10 w-10 mx-auto text-muted-foreground" />
        <h1 className="text-xl font-semibold">{c.title}</h1>
        <p className="text-muted-foreground">{c.body}</p>
      </div>
    </div>
  )
}
