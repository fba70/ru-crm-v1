"use client"

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

// A small, fast, app-styled hover tooltip for triggers that can't tolerate
// being wrapped in an extra DOM element or in Radix's `Tooltip.Trigger`
// (`asChild` Slot composition) — e.g. a shadcn `TabsTrigger`, whose
// `flex-1` + `h-[calc(100%-1px)]` classes require it to stay a *direct*
// flex child of `TabsList`, and whose `data-[state=active]` styling broke
// every time it was nested inside `<Tooltip><TooltipTrigger asChild>`
// (tried directly, and via an intermediate `<span>`, with and without
// `display: contents` — all three regressed something: active-state
// styling, flex sizing, or Popper's positioning landing on a degenerate
// {0,0,0,0} rect). The native `title` attribute is the zero-risk fallback
// (used briefly here) but is slow and browser-styled, not this app's own
// tooltip look.
//
// Same technique as `<FollowCursorTooltip>` — Popover + a `virtualRef`
// (Radix's documented pattern for anchoring to something other than a real
// mounted trigger element) — except the anchor is a *static* rect (the
// hovered element's own bounding box) instead of a cursor-following point,
// and there's no wrapping element: `useAnchorTooltip()` returns plain
// `onMouseEnter`/`onMouseLeave` handlers meant to be spread directly onto
// the existing trigger's own props, so the trigger's DOM node and React
// tree are completely untouched.
export function useAnchorTooltip() {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const virtualRef = useRef({ getBoundingClientRect: () => new DOMRect() })

  useEffect(() => {
    if (!rect) return
    virtualRef.current = { getBoundingClientRect: () => rect }
  }, [rect])

  return {
    open: rect !== null,
    virtualRef,
    bind: {
      onMouseEnter: (e: ReactMouseEvent<HTMLElement>) =>
        setRect(e.currentTarget.getBoundingClientRect()),
      onMouseLeave: () => setRect(null),
    },
  }
}

export function AnchorTooltip({
  text,
  open,
  virtualRef,
  side = "bottom",
}: {
  text: string
  open: boolean
  virtualRef: React.RefObject<{ getBoundingClientRect: () => DOMRect }>
  side?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <Popover open={open}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side={side}
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="pointer-events-none w-fit rounded-md border-none bg-foreground px-2 py-1 text-xs text-background shadow-md"
      >
        {text}
      </PopoverContent>
    </Popover>
  )
}
