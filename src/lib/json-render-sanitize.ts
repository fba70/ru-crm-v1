// Defends json-render against incomplete/loose specs where an element's
// `bindings` or `props` is null/undefined. OpenAI reliably emits `{}`, but
// Gemini occasionally omits these keys or sets them to null — which then
// crashes json-render's `resolveBindings` with
// `TypeError: Cannot convert undefined or null to object` (Object.entries).

export function sanitizeSpec<T>(input: T): T {
  if (input == null || typeof input !== "object") return input
  if (Array.isArray(input)) {
    return input.map((v) => sanitizeSpec(v)) as unknown as T
  }
  const obj = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = sanitizeSpec(v)
  }
  const isElement = typeof obj.component === "string"
  if (isElement || "bindings" in obj) {
    if (out.bindings == null) out.bindings = {}
  }
  if (isElement || "props" in obj) {
    if (out.props == null) out.props = {}
  }
  return out as T
}
