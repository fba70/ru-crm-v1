"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Copy,
  FileText,
  ImageIcon,
  Mic,
  Film,
  Captions,
  BookOpen,
  Presentation,
  MessageSquare,
  FileSpreadsheet,
  FileType,
  HardDrive,
  CloudUpload,
  Loader,
  Check,
} from "lucide-react"
import { Streamdown } from "streamdown"
import { toast } from "sonner"

// ── Types ─────────────────────────────────────────────────────────────

export type ParsedAttachmentKind =
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "video_audio"
  | "docx"
  | "pptx"
  | "docs"
  | "slides"
  | "sheets"

export type ParsedAttachment =
  | {
      kind: ParsedAttachmentKind
      fileName: string
      sourceId: string
      contentType: string
      byteSize: number
      markdown: string
    }
  | {
      fileName: string
      contentType: string
      byteSize: number
      skipped: string
    }

// ── Per-kind title + icon ─────────────────────────────────────────────

export const ATTACHMENT_LABELS: Record<
  ParsedAttachmentKind,
  { title: string; icon: React.ReactNode }
> = {
  pdf: { title: "PDF attachment", icon: <FileText className="h-4 w-4" /> },
  image: {
    title: "Image attachment",
    icon: <ImageIcon className="h-4 w-4" />,
  },
  audio: { title: "Audio attachment", icon: <Mic className="h-4 w-4" /> },
  video: { title: "Video attachment", icon: <Film className="h-4 w-4" /> },
  video_audio: {
    title: "Audio transcript (from video)",
    icon: <Captions className="h-4 w-4" />,
  },
  docx: { title: "Word document", icon: <BookOpen className="h-4 w-4" /> },
  pptx: {
    title: "Presentation",
    icon: <Presentation className="h-4 w-4" />,
  },
  docs: {
    title: "Google Doc",
    icon: <FileType className="h-4 w-4" />,
  },
  slides: {
    title: "Google Slides",
    icon: <Presentation className="h-4 w-4" />,
  },
  sheets: {
    title: "Google Sheet",
    icon: <FileSpreadsheet className="h-4 w-4" />,
  },
}

// The primary source-body icon — used by the email panel ("Email body") and
// the chat panel ("Chat message"). Kept here so every panel stays visually
// consistent.
export const BODY_ICONS = {
  email: <MessageSquare className="h-4 w-4" />,
  chat: <MessageSquare className="h-4 w-4" />,
  drive: <HardDrive className="h-4 w-4" />,
}

// ── Helpers ───────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// Streamdown doesn't understand YAML frontmatter — it renders `---` as an
// `<hr>`, bullet-style list entries as markdown bullets, and collapses keys
// with no indented children into a paragraph. Rewrite the frontmatter block
// into a fenced yaml code block so Shiki highlights it with proper line
// breaks. The canonical markdown (what "Copy" and "Raw markdown source"
// expose) is left untouched.
export function renderableMarkdown(md: string): string {
  const match = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return md
  const [, frontmatter, body] = match
  return `\`\`\`yaml\n${frontmatter}\n\`\`\`\n\n${body}`
}

// ── ParsedBlock component ─────────────────────────────────────────────
//
// Renders parsed markdown (YAML frontmatter + ## Summary + ## Content)
// as a single card. The wrapping caller (e.g. <ParsedMarkdownDialog>)
// owns the title — this component renders no header of its own to
// avoid the duplicate-title nesting we used to have inside the modal.
//
// Width / overflow behaviour: the card stretches to fit its container
// (`max-w-none` removes the default `prose` width clamp) and clips
// horizontal overflow so long code blocks / wide tables don't push the
// dialog wider than its `sm:max-w-*`. Long unbroken strings (URLs,
// hashes) wrap via `wrap-break-word`. The dialog itself owns vertical
// scroll, so this card grows naturally without an inner scrollbar.

export function ParsedBlock({
  markdown,
  sourceId,
  parentSourceId,
}: {
  markdown: string
  // When provided, shows a "Save to R2" button that uploads `markdown`
  // keyed under the active org. Legacy path — current callers go
  // through the per-row Upload button on the Pending / Processed table
  // instead. Kept for ad-hoc rendering.
  sourceId?: string
  // Real `source.id` (UUID) from the system-source dictionary. When
  // provided, the R2 key path nests under that source row, matching
  // the canonical `org_<orgId>/source_<sourceId>/…` convention from
  // the schema. Omit to fall back to the temporary `parsed/…` path.
  parentSourceId?: string
}) {
  const [saving, setSaving] = useState(false)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(markdown)
      toast.success("Markdown copied")
    } catch {
      toast.error("Could not copy to clipboard")
    }
  }

  async function handleSaveToR2() {
    if (!sourceId) return
    setSaving(true)
    try {
      const res = await fetch("/api/sources/r2/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, parentSourceId, markdown }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save to R2")
      setSavedKey(data.key)
      toast.success(`Saved to R2: ${data.key}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center justify-end gap-2">
        {sourceId && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveToR2}
            disabled={saving}
            title={savedKey ?? undefined}
          >
            {saving ? (
              <Loader className="animate-spin h-4 w-4 mr-1" />
            ) : savedKey ? (
              <Check className="h-4 w-4 mr-1" />
            ) : (
              <CloudUpload className="h-4 w-4 mr-1" />
            )}
            {saving ? "Saving…" : savedKey ? "Saved" : "Save to R2"}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleCopy}>
          <Copy className="h-4 w-4 mr-1" />
          Copy
        </Button>
      </div>
      <div
        className="rounded-md border bg-muted/30 p-4 prose prose-sm dark:prose-invert max-w-none overflow-x-auto wrap-break-word [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_table]:block [&_table]:overflow-x-auto [&_img]:max-w-full [&_img]:h-auto"
      >
        <Streamdown>{renderableMarkdown(markdown)}</Streamdown>
      </div>
      <details className="rounded-md border bg-muted/10">
        <summary className="px-3 py-2 text-xs cursor-pointer select-none">
          Raw markdown source
        </summary>
        <pre className="px-3 pb-3 text-xs overflow-x-auto whitespace-pre-wrap wrap-break-word">
          {markdown}
        </pre>
      </details>
    </div>
  )
}
