"use client"

import { useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/blocks/loading-button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Upload, X } from "lucide-react"
import { toast } from "sonner"

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type UploadResult =
  | { fileName: string; ok: true; itemId: string; childCount: number }
  | { fileName: string; ok: false; error: string; reason: string }

// Drop-off upload dialog. Always rendered as a controlled component by
// SourcesPageShell — `open`/`onOpenChange` come from the shell so the
// SyncActionBar's "Drop Off Your Files" button can drive it. On submit
// the selected files are POSTed to /api/sources/dropoff/upload, which
// parses them inline and inserts source_item rows directly in the
// Processed bucket. `onUploaded` is the cross-table refresh hook.
export function DropoffUploadDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploaded: () => void
}) {
  const [selected, setSelected] = useState<File[]>([])
  const [description, setDescription] = useState("")
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setSelected([])
    setDescription("")
    setDragging(false)
  }

  function addFromList(list: FileList | null) {
    if (!list) return
    const picked = Array.from(list)
    setSelected((prev) => {
      // Dedupe by name+size so dropping the same file twice doesn't double up.
      const seen = new Set(prev.map((f) => `${f.name}-${f.size}`))
      const merged = [...prev]
      for (const f of picked) {
        const key = `${f.name}-${f.size}`
        if (!seen.has(key)) {
          merged.push(f)
          seen.add(key)
        }
      }
      return merged
    })
  }

  function removeAt(i: number) {
    setSelected((prev) => prev.filter((_, j) => j !== i))
  }

  async function handleSubmit() {
    if (selected.length === 0 || uploading) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("description", description)
      for (const f of selected) fd.append("files", f, f.name)
      const res = await fetch("/api/sources/dropoff/upload", {
        method: "POST",
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Upload failed")

      const results = (data.results ?? []) as UploadResult[]
      const okCount = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok)
      if (okCount > 0) {
        toast.success(
          `Parsed ${okCount} ${okCount === 1 ? "file" : "files"} → Processed`,
        )
      }
      for (const f of failed) {
        toast.error(`${f.fileName}: ${f.error}`)
      }

      onUploaded()
      reset()
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      toast.error(`Upload: ${msg}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (uploading) return
        onOpenChange(o)
        if (!o) reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Drop off files</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              setDragging(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              addFromList(e.dataTransfer.files)
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 cursor-pointer transition ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/30 hover:border-muted-foreground/50"
            }`}
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              Drop files here, or click to browse
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addFromList(e.target.files)
                e.target.value = ""
              }}
            />
          </div>

          {selected.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {selected.map((f, i) => (
                <div
                  key={`${f.name}-${f.size}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-sm bg-muted/50 px-2 py-1 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" title={f.name}>
                      {f.name}
                    </div>
                    <div className="text-muted-foreground">
                      {formatSize(f.size)}
                      {f.type ? ` · ${f.type}` : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    disabled={uploading}
                    onClick={() => removeAt(i)}
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="dropoff-description" className="text-gray-400">
              Description (optional)
            </Label>
            <Textarea
              id="dropoff-description"
              rows={3}
              placeholder="Briefly describe what these files are…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={uploading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            Cancel
          </Button>
          <LoadingButton
            type="button"
            onClick={handleSubmit}
            loading={uploading}
            disabled={selected.length === 0}
          >
            Upload &amp; parse{selected.length > 0 ? ` (${selected.length})` : ""}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
