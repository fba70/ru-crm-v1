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
import { FolderUp, X, MessageCircle } from "lucide-react"
import { toast } from "sonner"

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

// Chunk size for the chunked upload loop. Tuned to:
//   • Comfortably fit inside Vercel's 300 s function timeout even when
//     a chunk lands a couple of MP4s (≤ 60 s per video × 5 = 300 s).
//   • Keep total round-trips reasonable (< 100 chunks) for typical
//     archives (~250–500 files).
//   • Give the user visible progress every few seconds.
const CHUNK_SIZE = 5

// Augmented File type — the browser sets `webkitRelativePath` on each
// File when picked through `<input webkitdirectory>`. The DOM lib types
// already declare this property, but TS narrows it to `string` so we
// just use it directly.
type FilePicked = File & { webkitRelativePath: string }

type UploadResponse = {
  chatFormat: "ios" | "android" | "unknown"
  groupCount: number
  attachmentCount: number
  failedCount: number
  results: ResultEntry[]
}

type ResultEntry =
  | {
      kind: "group"
      groupKey: string
      itemId: string
      ok: true
      inserted: boolean
      startTimestamp: string
      endTimestamp: string
      authors: string[]
      attachmentRefs: number
    }
  | {
      kind: "attachment"
      fileName: string
      itemId: string
      ok: true
      inserted: boolean
      parentItemId: string | null
    }
  | {
      kind: "attachment"
      fileName: string
      ok: false
      reason: "unsupported" | "too_large" | "failed"
      error: string
    }

// WhatsApp archive import dialog. Always rendered as a controlled
// component by SourcesPageShell — `open`/`onOpenChange` come from the
// shell so the SyncActionBar's "Sync from WhatsApp Archive" button can
// drive it.
//
// Upload runs in chunks of CHUNK_SIZE files. The first chunk always
// includes `_chat.txt` (when present) so the chat groups land before
// any attachment chunks need to look up parent linkage. Subsequent
// chunks carry only media files; the server resolves `<attached: …>`
// references against chat groups already in the DB.
export function WhatsAppArchiveDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploaded: () => void
}) {
  const [selected, setSelected] = useState<FilePicked[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{
    done: number
    total: number
    chunks: { done: number; total: number }
    groups: number
    attachments: number
    failed: number
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setSelected([])
    setProgress(null)
  }

  function pickFiles(list: FileList | null) {
    if (!list) return
    const picked = Array.from(list) as FilePicked[]
    // Filter out OS junk that web pickers happily include — `.DS_Store`
    // on macOS and `Thumbs.db` on Windows show up in arbitrary folders
    // and only confuse the per-file outcome list.
    const filtered = picked.filter((f) => {
      const name = f.name.toLowerCase()
      return name !== ".ds_store" && name !== "thumbs.db"
    })
    setSelected(filtered)
  }

  function removeAt(i: number) {
    setSelected((prev) => prev.filter((_, j) => j !== i))
  }

  const chatFile = selected.find((f) => f.name.toLowerCase() === "_chat.txt")
  const totalBytes = selected.reduce((sum, f) => sum + f.size, 0)

  // Builds the chunked queue: chat file first (so groups exist before
  // attachments need their parent), then everything else in CHUNK_SIZE
  // batches. Chat file gets its own chunk so the first request finishes
  // quickly and the user sees immediate progress.
  function buildChunks(files: FilePicked[]): FilePicked[][] {
    const chat = files.find((f) => f.name.toLowerCase() === "_chat.txt")
    const rest = files.filter((f) => f !== chat)
    const chunks: FilePicked[][] = []
    if (chat) chunks.push([chat])
    for (let i = 0; i < rest.length; i += CHUNK_SIZE) {
      chunks.push(rest.slice(i, i + CHUNK_SIZE))
    }
    return chunks
  }

  async function uploadOne(chunk: FilePicked[]): Promise<UploadResponse> {
    const fd = new FormData()
    for (const f of chunk) {
      fd.append("files", f, f.name)
      fd.append("paths", f.webkitRelativePath || f.name)
    }
    const res = await fetch("/api/sources/whatsapp/upload", {
      method: "POST",
      body: fd,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Ошибка загрузки")
    return data as UploadResponse
  }

  async function handleSubmit() {
    if (selected.length === 0 || uploading) return
    const chunks = buildChunks(selected)
    setUploading(true)
    setProgress({
      done: 0,
      total: selected.length,
      chunks: { done: 0, total: chunks.length },
      groups: 0,
      attachments: 0,
      failed: 0,
    })

    const allFailures: { fileName: string; error: string }[] = []
    let totalGroups = 0
    let totalAttachments = 0
    let totalFailed = 0

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        try {
          const result = await uploadOne(chunk)
          totalGroups += result.groupCount
          totalAttachments += result.attachmentCount
          totalFailed += result.failedCount
          for (const r of result.results) {
            if (r.kind === "attachment" && !r.ok) {
              allFailures.push({ fileName: r.fileName, error: r.error })
            }
          }
        } catch (err) {
          // Whole-chunk failure (network, 5xx, timeout). Mark every
          // file in this chunk as failed so the user knows nothing
          // landed for this batch — but keep going; subsequent chunks
          // are independent.
          const msg = err instanceof Error ? err.message : "Неизвестная ошибка"
          for (const f of chunk) {
            allFailures.push({ fileName: f.name, error: msg })
            totalFailed++
          }
        }

        // Progress update — `done` counts files attempted (not just
        // succeeded) so the bar fills monotonically.
        setProgress((prev) =>
          prev
            ? {
                ...prev,
                done: prev.done + chunk.length,
                chunks: { done: i + 1, total: chunks.length },
                groups: totalGroups,
                attachments: totalAttachments,
                failed: totalFailed,
              }
            : prev,
        )
      }

      // Final summary toasts — one per category so the user can see
      // the breakdown without scrolling a multiline message.
      if (totalGroups > 0) {
        toast.success(
          `Импортировано ${totalGroups} ${plural(totalGroups, ["группа чата", "группы чата", "групп чата"])} → В очередь`,
        )
      }
      if (totalAttachments > 0) {
        toast.success(
          `Разобрано ${totalAttachments} ${plural(totalAttachments, ["вложение", "вложения", "вложений"])} → Обработано`,
        )
      }
      // Per-file failure toasts — capped so a catastrophic upload
      // doesn't bury the user in 500 toasts. The full list is in
      // browser devtools / sonner history if they need it.
      const FAILURE_TOAST_CAP = 8
      for (const f of allFailures.slice(0, FAILURE_TOAST_CAP)) {
        toast.error(`${f.fileName}: ${f.error}`)
      }
      if (allFailures.length > FAILURE_TOAST_CAP) {
        toast.error(
          `…и ещё ${allFailures.length - FAILURE_TOAST_CAP} ошибок (см. таблицы «В очереди» / «Обработано»)`,
        )
      }
      if (
        totalGroups === 0 &&
        totalAttachments === 0 &&
        totalFailed === 0
      ) {
        toast.message(
          "Нечего импортировать — в папке не найдено распознанного содержимого",
        )
      }

      onUploaded()
      reset()
      onOpenChange(false)
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
      {/* Wider modal for long file paths; outer overflow-hidden keeps
          the file list rows from visually escaping the dialog body. */}
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Импорт архива WhatsApp</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 min-w-0 flex-1 overflow-y-auto">
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
            className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/30 hover:border-muted-foreground/50 p-6 cursor-pointer transition"
          >
            <FolderUp className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              Нажмите, чтобы выбрать папку с архивом WhatsApp
            </p>
            <p className="text-xs text-muted-foreground/80 text-center">
              Включает <code>_chat.txt</code> + медиафайлы
            </p>
            <input
              ref={inputRef}
              type="file"
              {...({
                webkitdirectory: "",
                directory: "",
              } as Record<string, string>)}
              multiple
              className="hidden"
              onChange={(e) => {
                pickFiles(e.target.files)
                e.target.value = ""
              }}
            />
          </div>

          {selected.length > 0 && !uploading && (
            <div className="space-y-2 min-w-0">
              <div className="flex items-center justify-between text-xs text-muted-foreground gap-2 flex-wrap">
                <span>
                  {selected.length}{" "}
                  {plural(selected.length, ["файл", "файла", "файлов"])} ·{" "}
                  {formatSize(totalBytes)}
                </span>
                {chatFile ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 shrink-0">
                    <MessageCircle className="h-3.5 w-3.5" />
                    Найден <code className="text-xs">_chat.txt</code>
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400 shrink-0">
                    Нет <code className="text-xs">_chat.txt</code> — импорт только
                    медиа
                  </span>
                )}
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto overflow-x-hidden">
                {selected.map((f, i) => (
                  <div
                    key={`${f.webkitRelativePath || f.name}-${f.size}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-sm bg-muted/50 px-2 py-1 text-xs min-w-0 overflow-hidden"
                  >
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div
                        className="truncate font-medium"
                        title={f.webkitRelativePath || f.name}
                      >
                        {f.webkitRelativePath || f.name}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {formatSize(f.size)}
                        {f.type ? ` · ${f.type}` : ""}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => removeAt(i)}
                      aria-label={`Удалить ${f.name}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {progress && (
            <ProgressPanel
              done={progress.done}
              total={progress.total}
              chunkDone={progress.chunks.done}
              chunkTotal={progress.chunks.total}
              groups={progress.groups}
              attachments={progress.attachments}
              failed={progress.failed}
            />
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            Отмена
          </Button>
          <LoadingButton
            type="button"
            onClick={handleSubmit}
            loading={uploading}
            disabled={selected.length === 0}
          >
            Импортировать и разобрать{selected.length > 0 ? ` (${selected.length})` : ""}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Live progress block. Bar fills as files are attempted; counters
// update per chunk. Stays mounted after upload completes briefly so
// the user sees the final tallies before the dialog closes (handled
// by `reset()` in the caller).
function ProgressPanel({
  done,
  total,
  chunkDone,
  chunkTotal,
  groups,
  attachments,
  failed,
}: {
  done: number
  total: number
  chunkDone: number
  chunkTotal: number
  groups: number
  attachments: number
  failed: number
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const inFlight = chunkDone < chunkTotal
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">
          {inFlight
            ? `Обработка партии ${chunkDone + 1} из ${chunkTotal}…`
            : "Готово"}
        </span>
        <span className="text-muted-foreground">
          {done} / {total} файлов · {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {groups > 0 && <span>{groups} групп чата → В очередь</span>}
        {attachments > 0 && (
          <span>{attachments} вложений → Обработано</span>
        )}
        {failed > 0 && (
          <span className="text-destructive">ошибок {failed}</span>
        )}
      </div>
    </div>
  )
}
