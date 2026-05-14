"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ParsedBlock } from "@/components/blocks/parsed-source-ui"
import { Loader } from "lucide-react"

// Modal wrapper around the existing ParsedBlock renderer. Fetches the
// markdown for a given source_item id from /api/sources/items/[id]/markdown
// (which returns the DB-cached copy when present, otherwise reads from R2).
//
// Layout: the dialog owns the visible name (DialogTitle) and the single
// outer scroll container; ParsedBlock renders a single card inside with
// the YAML frontmatter + Summary + Content together. No duplicate
// title, no nested cards. `sm:max-w-5xl` widens the previous `3xl` so
// transcripts and code blocks read comfortably without horizontal squeeze.
export function ParsedMarkdownDialog({
  itemId,
  title,
  open,
  onOpenChange,
}: {
  itemId: string | null
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // `loading` is derived rather than stored — when the dialog is open
  // for a specific item but neither result nor error has landed yet,
  // we're loading. Avoids a sync setState inside the fetch effect.
  const loading = open && itemId !== null && markdown === null && error === null

  useEffect(() => {
    if (!open || !itemId) return
    let cancelled = false
    fetch(`/api/sources/items/${itemId}/markdown`)
      .then(async (res) => {
        if (cancelled) return
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || "Failed to load markdown")
        } else {
          setMarkdown(data.markdown)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Unknown error")
      })
    return () => {
      cancelled = true
    }
  }, [open, itemId])

  // Reset displayed content whenever the dialog is closed so the next
  // open starts fresh. Done via callback prop wrapper rather than an
  // effect to avoid the cascading-render warning.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setMarkdown(null)
      setError(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base truncate">{title}</DialogTitle>
        </DialogHeader>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}
        {error && <p className="text-sm text-destructive py-4">{error}</p>}
        {markdown && <ParsedBlock markdown={markdown} />}
      </DialogContent>
    </Dialog>
  )
}
