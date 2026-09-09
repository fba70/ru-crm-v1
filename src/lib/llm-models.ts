// Shared LLM-model dictionary for client-side pickers + server-side gateway
// routing. The AI chat header, the Explore-sources dialog, and any future
// model-pick UI should import MODELS from here rather than duplicating the
// list. The /api/chat handler also reads SUPPORTED_MODELS from here so a new
// model lands by adding one entry to this file.

export type LlmProvider = "openai" | "google" | "anthropic"

export type LlmModel = {
  key: string
  label: string
  provider: LlmProvider
  gatewayId: string
}

export const MODELS: LlmModel[] = [
  {
    key: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    provider: "google",
    gatewayId: "google/gemini-3.1-flash-lite",
  },
  {
    key: "gpt-5-mini",
    label: "GPT-5 Mini",
    provider: "openai",
    gatewayId: "openai/gpt-5-mini",
  },
  {
    key: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    gatewayId: "anthropic/claude-sonnet-4-6",
  },
]

export const DEFAULT_MODEL_KEY = "gemini-3.1-flash-lite"

// Gateway id of the default model, for server modules that don't take a
// user-picked key (web lookup, chat analysis, analytics assistant).
export const DEFAULT_GATEWAY_ID = "google/gemini-3.1-flash-lite"

export function getModel(key: string): LlmModel | undefined {
  return MODELS.find((m) => m.key === key)
}

export function getGatewayId(key: string): string {
  const m = getModel(key)
  if (!m) throw new Error(`Unsupported model: ${key}`)
  return m.gatewayId
}

// Model behind `searchWeb` (src/server/web-search.ts). Web search is its own
// grounded Gemini sub-call rather than a tool passed through to whichever
// model the user picked, so EVERY model in the picker gets working web search
// — and grounding stops depending on the chat model's mood. Must be a Gemini
// model: `google_search` is Google's own grounding tool.
export const WEB_SEARCH_MODEL = "google/gemini-3.1-flash-lite"
