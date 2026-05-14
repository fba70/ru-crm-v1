import { NextRequest, NextResponse } from "next/server"
import {
  generateDeals,
  previewDealDiscoveryCandidates,
  type GenerateDealsInput,
} from "@/server/deals-discovery"

// Same envelope as /api/cards/generate — per-item LLM × concurrency 3 ×
// cap 50 fits comfortably inside Vercel Functions' 300s.
export const maxDuration = 300

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message.endsWith("not found")
        ? 404
        : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const sourceIdsRaw = url.searchParams.get("sourceIds")
    const sourceIds = sourceIdsRaw
      ? sourceIdsRaw.split(",").filter(Boolean)
      : null
    const preview = await previewDealDiscoveryCandidates({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      sourceIds,
      includeAlreadyAnalyzed:
        url.searchParams.get("includeAlreadyAnalyzed") === "1",
    })
    return NextResponse.json(preview)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<GenerateDealsInput>
    if (!body.ruleId) {
      return NextResponse.json(
        { error: "ruleId is required" },
        { status: 400 },
      )
    }
    if (!body.modelKey) {
      return NextResponse.json(
        { error: "modelKey is required" },
        { status: 400 },
      )
    }
    const result = await generateDeals({
      from: body.from ?? null,
      to: body.to ?? null,
      sourceIds: body.sourceIds ?? null,
      ruleId: body.ruleId,
      modelKey: body.modelKey,
      includeAlreadyAnalyzed: body.includeAlreadyAnalyzed === true,
    })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return errorResponse(error)
  }
}
