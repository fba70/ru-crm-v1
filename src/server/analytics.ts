"use server"

// Session gate for the sales analytics. The aggregation itself lives in
// `analytics-query.ts`, which takes the organization id as an explicit
// argument; this module is the only thing that decides WHICH org the caller
// may read, and it takes that strictly from the session — never from
// caller-supplied input.

import { getServerSession } from "@/lib/get-session"
import {
  computeAnalyticsBounds,
  computeSalesAnalytics,
} from "@/server/analytics-query"

export type {
  AnalyticsRange,
  AnalyticsTotals,
  TimePoint,
  SliceRow,
  StackPoint,
  StatusRow,
  ClientScatterPoint,
  ProductRow,
  SalesAnalytics,
} from "@/server/analytics-query"

async function requireOrganizationId(): Promise<string> {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const organizationId = session.session.activeOrganizationId
  if (!organizationId) throw new Error("No active organization")
  return organizationId
}

export async function getSalesAnalytics(params: { from: string; to: string }) {
  return computeSalesAnalytics({
    organizationId: await requireOrganizationId(),
    from: params.from,
    to: params.to,
  })
}

/**
 * Earliest + latest order date in the org, so the page can default its range to
 * the data that actually exists instead of an empty "current month".
 */
export async function getAnalyticsBounds() {
  return computeAnalyticsBounds(await requireOrganizationId())
}
