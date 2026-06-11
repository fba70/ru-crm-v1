// Client "custom fields" — an extensible jsonb bag on the `client` row
// (`client.custom_fields`). The shape is deliberately open so per-tenant
// catalog attributes can grow without a migration. Today the only key is
// `type`, and it's only populated for one org (see below).
//
// This module is client-safe (no "server-only", no DB imports) so the edit
// form, the server functions, and the schema's `$type<>()` can all share it.

/**
 * Org whose clients carry the structured `type` custom field (a value from
 * `CLIENT_TYPE_VALUES`). Every other org stores an empty `{}` custom-fields
 * object — the `type` selector is hidden for them.
 */
export const CLIENT_TYPE_ORG_ID = "1dNkC4rBtl9FEvnK95Svlfs63oSU57Ni"

/** Allowed `type` values for the designated org. */
export const CLIENT_TYPE_VALUES = [
  "on_trade",
  "off_trade",
  "own_needs",
  "internet_shop",
] as const

export type ClientType = (typeof CLIENT_TYPE_VALUES)[number]

/** Human-readable labels for the `type` select. */
export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  on_trade: "On-trade",
  off_trade: "Off-trade",
  own_needs: "Own needs",
  internet_shop: "Internet shop",
}

/** Extensible per-client custom-fields bag stored as jsonb. */
export type ClientCustomFields = {
  type?: ClientType
} & Record<string, unknown>

/** Whether the given org gets the structured `type` custom field. */
export function orgHasStructuredClientType(
  organizationId: string | null | undefined,
): boolean {
  return organizationId === CLIENT_TYPE_ORG_ID
}

/** Narrowing guard for an arbitrary value against `ClientType`. */
export function isClientType(value: unknown): value is ClientType {
  return (
    typeof value === "string" &&
    (CLIENT_TYPE_VALUES as readonly string[]).includes(value)
  )
}
