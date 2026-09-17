"use client"

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

// A tooltip that tracks the cursor while it's over the wrapped element,
// instead of anchoring to a fixed trigger box like the standard Radix
// tooltip (`@/components/ui/tooltip`) does. Built for wide/tall trigger
// areas — e.g. a drawer's title field spanning most of the header row —
// where a corner-anchored tooltip reads as detached from wherever the
// cursor actually is.
//
// Built on Popover, not Tooltip: Radix's `Tooltip.Trigger` only accepts a
// real rendered DOM node as its anchor, while `Popover.Anchor` accepts a
// `virtualRef` — any object exposing `getBoundingClientRect()` — the
// documented Radix pattern for anchoring to an arbitrary point instead of
// an element (the same mechanism a right-click context menu uses to open
// at the pointer). We move that virtual point to the cursor on every
// mousemove; Radix's own Popper positioning then does the actual
// placement math (`side="right"`, `avoidCollisions` flip near the
// viewport edge) — no hand-rolled viewport/overflow logic needed.
export function FollowCursorTooltip({
  text,
  // Suppresses the tooltip entirely (e.g. while the wrapped field is
  // focused/being edited) without the caller having to conditionally
  // render this wrapper itself.
  disabled = false,
  children,
  className,
}: {
  text: string
  disabled?: boolean
  children: ReactNode
  className?: string
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)

  // Radix's Popper.Anchor (which PopoverAnchor wraps) re-reads
  // `virtualRef.current` from its own effect that re-runs after every
  // render, so syncing it here — in an effect, not during render, where
  // mutating a ref is disallowed — is what lets the anchor track the
  // cursor on each mousemove. (Runs one commit behind Radix's own
  // child-before-parent effect ordering, i.e. a single mousemove sample —
  // imperceptible for a cursor-following tooltip.)
  //
  // Skips the update while `point` is null (cursor left) — the closing
  // animation keeps PopoverContent mounted for its fade-out, still
  // reactively tracking the anchor, so writing a degenerate (0,0) rect
  // here made the tooltip visibly jump to the screen's top-left corner
  // mid-fade-out. Leaving the anchor at its last real position instead
  // means a reopen (or the tail of a close) just holds still there.
  const virtualRef = useRef({ getBoundingClientRect: () => new DOMRect() })
  useEffect(() => {
    if (!point) return
    virtualRef.current = {
      getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0),
    }
  }, [point])

  const open = point !== null && !disabled

  return (
    <Popover open={open} onOpenChange={(next) => !next && setPoint(null)}>
      <PopoverAnchor virtualRef={virtualRef} />
      <div
        className={className}
        onMouseMove={(e: MouseEvent<HTMLDivElement>) =>
          setPoint({ x: e.clientX, y: e.clientY })
        }
        onMouseLeave={() => setPoint(null)}
      >
        {children}
      </div>
      <PopoverContent
        side="right"
        sideOffset={10}
        // align="start" pins the tooltip's top edge to the cursor's y —
        // since it extends downward from there, this is what actually
        // reads as "below the cursor" (the default "center" straddles it
        // vertically, which looks like it's fighting the pointer for the
        // same spot). alignOffset nudges it down a touch further so it
        // doesn't start flush against the cursor tip.
        align="start"
        alignOffset={6}
        // Purely informational — never let it steal keyboard focus from the
        // field it's labelling (the exact "focus lands somewhere unwanted"
        // problem this tooltip was added to avoid in the first place).
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="pointer-events-none w-fit rounded-md border-none bg-foreground px-2 py-1 text-xs text-background shadow-md"
      >
        {text}
      </PopoverContent>
    </Popover>
  )
}
