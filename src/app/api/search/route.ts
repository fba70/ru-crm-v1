import { NextRequest, NextResponse } from "next/server"
import { searchAcrossEntities } from "@/server/search"

export type {
  GlobalSearchResult,
  ClientSearchHit,
  ContactSearchHit,
  DealSearchHit,
  OrderSearchHit,
} from "@/server/search"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest) {
  try {
    const q = new URL(request.url).searchParams.get("q") ?? ""
    const result = await searchAcrossEntities(q)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
