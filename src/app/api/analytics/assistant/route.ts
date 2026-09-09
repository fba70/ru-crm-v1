import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai"
import { getServerSession } from "@/lib/get-session"
import { computeAnalyticsBounds } from "@/server/analytics-query"
import {
  buildAnalyticsSystemPrompt,
  buildAnalyticsTools,
} from "@/server/analytics-assistant"
import { DEFAULT_MODEL_KEY, getGatewayId } from "@/lib/llm-models"

export const maxDuration = 60

// Session gate + streaming for the analytics assistant. The prompt and the
// single `queryAnalytics` tool live in `src/server/analytics-assistant.ts`.
//
// The org id is bound into the tool from the SESSION — it is never a model
// input, so no prompt injection can widen the scope to another tenant.

const DEFAULT_MODEL = DEFAULT_MODEL_KEY

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json()

    const session = await getServerSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return Response.json({ error: "No active organization" }, { status: 403 })
    }

    // Default window = the org's real data span, so «за период» means something
    // even when the dataset doesn't straddle today.
    const bounds = await computeAnalyticsBounds(organizationId)
    const from = bounds.first
      ? new Date(`${bounds.first}T00:00:00.000Z`)
      : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1))
    const to = bounds.last
      ? new Date(new Date(`${bounds.last}T00:00:00.000Z`).getTime() + 86_400_000)
      : new Date()

    const result = streamText({
      model: getGatewayId(DEFAULT_MODEL),
      system: buildAnalyticsSystemPrompt({
        from: bounds.first ?? "—",
        to: bounds.last ?? "—",
      }),
      messages: await convertToModelMessages(messages),
      tools: buildAnalyticsTools(organizationId, { from, to }),
      // One query + one answer is the intended shape; a couple of extra steps
      // give room for a genuinely two-part question.
      stopWhen: stepCountIs(5),
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error("[analytics-assistant] Error:", error)
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
