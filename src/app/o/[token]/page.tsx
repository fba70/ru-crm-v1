import { resolveOrderLink } from "@/server/order-links"
import { LinkUnavailable } from "./unavailable"
import { GuestOrderReview } from "./guest-order-review"

// Guest order review — public (no auth). Always render fresh: the order state
// changes via guest mutations and internal transitions, and we never want a
// stale/cached view of a capability-gated page.
export const dynamic = "force-dynamic"

export default async function GuestOrderPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const res = await resolveOrderLink(token)
  if (!res.ok) return <LinkUnavailable reason={res.reason} />
  return <GuestOrderReview token={token} view={res.view} />
}
