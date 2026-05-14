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
    key: "gpt-5-mini",
    label: "GPT-5 Mini",
    provider: "openai",
    gatewayId: "openai/gpt-5-mini",
  },
  {
    key: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    gatewayId: "google/gemini-2.5-flash",
  },
  {
    key: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    gatewayId: "anthropic/claude-sonnet-4-6",
  },
]

export const DEFAULT_MODEL_KEY = "gemini-2.5-flash"

export function getModel(key: string): LlmModel | undefined {
  return MODELS.find((m) => m.key === key)
}

export function getGatewayId(key: string): string {
  const m = getModel(key)
  if (!m) throw new Error(`Unsupported model: ${key}`)
  return m.gatewayId
}
