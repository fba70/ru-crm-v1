import { generateKeyBetween } from "fractional-indexing"

// Manual-order key math for the deals kanban (refs/kanban-spec.md → lib/move.ts).
//
// Each deal carries a fractional-indexing string `position` that orders it
// WITHIN a funnel-stage column. To move a card, the client resolves the keys of
// the neighbours straddling the drop point and asks for a key strictly between
// them — no renumbering of siblings, no float exhaustion.
//
// `generateKeyBetween(a, b)` requires a < b (or a null bound). Pass:
//   • drop at top of column    → computePosition(null, firstKey)
//   • drop between two cards    → computePosition(beforeKey, afterKey)
//   • drop at bottom / empty    → computePosition(lastKey, null)  (lastKey null if empty)
export function computePosition(
  beforeKey: string | null | undefined,
  afterKey: string | null | undefined,
): string {
  return generateKeyBetween(beforeKey ?? null, afterKey ?? null)
}
