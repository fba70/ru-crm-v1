"use client"

// Small reusable scroll-triggered loading hook — the app has no infinite-
// scroll pattern anywhere else (every other list uses classic page-number
// buttons or prev/next). Deliberately minimal: this hook only wires an
// IntersectionObserver to a sentinel element; the caller owns the actual
// rows/offset/hasMore/loading state (see `/clients` for the reference
// consumer).
import { useEffect, useRef } from "react"

export function useInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Ref so the observer callback always calls the latest closure without
  // needing to be torn down/rebuilt on every render. Updated in an effect
  // (not during render) per the rules of hooks.
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  }, [onLoadMore])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || loading) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMoreRef.current()
      },
      { rootMargin: "200px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loading])

  return { sentinelRef }
}
