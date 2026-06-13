"use client"

import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import type { UIMessage } from "@ai-sdk/react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader, Save, AlertTriangle } from "lucide-react"
import type { SaveChatSessionResult } from "@/app/api/sources/aichat/save/route"

type Phase = "idle" | "saving"

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

// What we send to the server: a flat per-message text + a list of files
// extracted from the in-memory data URLs. Tool calls / reasoning /
// json-render specs are intentionally dropped here per the design (Q4
// — conversation only).
type ExtractedMessage = { role: "user" | "assistant" | "system"; text: string }
type ExtractedFile = { fileName: string; mediaType: string; bytes: Uint8Array }

export function SaveChatDialog({
  trigger,
  messages,
  onSaved,
}: {
  trigger: React.ReactNode
  messages: UIMessage[]
  /** Called after the server confirms the save (cleanup hook). */
  onSaved: (result: SaveChatSessionResult) => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")

  // Extracted snapshot of what's about to be saved, derived from the
  // current messages prop. Re-computed when the dialog opens so we
  // capture exactly what the user can see.
  const extracted = useMemo(() => extractFromMessages(messages), [messages])

  // Default title prefilled from the first non-empty user text, capped
  // at ~60 chars. User edits before confirming.
  const defaultTitle = useMemo(() => {
    const firstUser = extracted.messages.find(
      (m) => m.role === "user" && m.text.trim().length > 0,
    )
    if (!firstUser) return "Сеанс AI-чата"
    const cleaned = firstUser.text.replace(/\s+/g, " ").trim()
    return cleaned.length > 60 ? cleaned.slice(0, 57) + "…" : cleaned
  }, [extracted])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) {
        setTitle(defaultTitle)
      } else {
        setTitle("")
        setPhase("idle")
      }
    },
    [defaultTitle],
  )

  const save = useCallback(async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast.error("Укажите название")
      return
    }
    setPhase("saving")
    try {
      const form = new FormData()
      form.append("title", trimmedTitle)
      form.append(
        "messages",
        JSON.stringify(
          extracted.messages.map((m) => ({ role: m.role, text: m.text })),
        ),
      )
      for (const file of extracted.files) {
        // Cast to BlobPart — Uint8Array<ArrayBufferLike> trips the
        // ArrayBufferView<ArrayBuffer> generic check in lib.dom under
        // strict mode, but the runtime spec accepts it fine.
        const blob = new Blob([file.bytes as BlobPart], {
          type: file.mediaType || "application/octet-stream",
        })
        form.append("files", blob, file.fileName)
      }

      const res = await fetch("/api/sources/aichat/save", {
        method: "POST",
        body: form,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить")
      const result = data as SaveChatSessionResult

      const childSummary =
        result.childInserted > 0 || result.childSkipped > 0 || result.childFailed > 0
          ? ` · вложено ${result.childInserted} ${plural(result.childInserted, ["файл", "файла", "файлов"])}` +
            (result.childSkipped > 0 ? `, пропущено ${result.childSkipped}` : "") +
            (result.childFailed > 0 ? `, с ошибкой ${result.childFailed}` : "")
          : ""
      toast.success(`Чат сохранён в источники${childSummary}`)
      onSaved(result)
      setOpen(false)
      setTitle("")
      setPhase("idle")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить")
      setPhase("idle")
    }
  }, [title, extracted, onSaved])

  // Some files in earlier turns may have been GC'd by the AI SDK and
  // appear as `url: ""` — we skip those silently. Surface a count so
  // the user knows what to expect.
  const droppedFileCount = extracted.droppedFileCount

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            Сохранить чат в источники
          </DialogTitle>
          <DialogDescription>
            Сохраняет текущую переписку как новый элемент источника. При
            сохранении извлекается анализ (резюме / упоминания / компании /
            товары). Вложенные файлы становятся дочерними элементами.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="save-chat-title" className="text-xs text-muted-foreground">
              Название
            </Label>
            <Input
              id="save-chat-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Сеанс AI-чата"
              disabled={phase === "saving"}
              autoFocus
            />
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <div>
              Будет сохранено <strong>{extracted.messages.length}</strong>{" "}
              {plural(extracted.messages.length, [
                "сообщение",
                "сообщения",
                "сообщений",
              ])}
              {extracted.files.length > 0
                ? ` и ${extracted.files.length} ${plural(extracted.files.length, ["файл", "файла", "файлов"])}`
                : ""}
              .
            </div>
            {droppedFileCount > 0 && (
              <div className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  {droppedFileCount}{" "}
                  {plural(droppedFileCount, [
                    "вложение",
                    "вложения",
                    "вложений",
                  ])}{" "}
                  из ранней части сеанса нельзя восстановить (хранились только в
                  памяти браузера).
                </span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={phase === "saving"}
          >
            Отмена
          </Button>
          <Button
            onClick={save}
            disabled={phase === "saving" || extracted.messages.length === 0}
          >
            {phase === "saving" ? (
              <>
                <Loader className="h-4 w-4 mr-1 animate-spin" />
                Сохранение…
              </>
            ) : (
              "Сохранить"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Extraction ───────────────────────────────────────────────────────

type ExtractedSnapshot = {
  messages: ExtractedMessage[]
  files: ExtractedFile[]
  /** Files we found references to but couldn't recover bytes for —
   *  surfaced in the UI as a warning so the user knows what's missing. */
  droppedFileCount: number
}

function extractFromMessages(messages: UIMessage[]): ExtractedSnapshot {
  const out: ExtractedMessage[] = []
  const files: ExtractedFile[] = []
  let droppedFileCount = 0
  // Dedup files by content — large attachments may have been re-sent
  // across turns; we want one child source_item per unique file.
  const seenFileKeys = new Set<string>()

  for (const msg of messages) {
    let textBuf = ""
    for (const part of msg.parts) {
      if (part.type === "text") {
        if (part.text) textBuf += (textBuf ? "\n" : "") + part.text
        continue
      }
      if (part.type === "file") {
        // FileUIPart: { url, mediaType, filename? }. URL is typically a
        // data URL (`data:<mime>;base64,<payload>`); occasionally it's
        // a remote URL we can't fetch from the client.
        const filePart = part as {
          url?: string
          mediaType?: string
          filename?: string
        }
        const url = filePart.url ?? ""
        const fileName = filePart.filename || guessFileName(url, filePart.mediaType)
        if (!url || !url.startsWith("data:")) {
          droppedFileCount++
          continue
        }
        const decoded = decodeDataUrl(url)
        if (!decoded) {
          droppedFileCount++
          continue
        }
        // Dedup key — content + filename. Same file referenced in two
        // turns lands once.
        const key = `${fileName}:${decoded.bytes.byteLength}`
        if (seenFileKeys.has(key)) continue
        seenFileKeys.add(key)
        files.push({
          fileName,
          mediaType: filePart.mediaType || decoded.mediaType,
          bytes: decoded.bytes,
        })
        continue
      }
      // Tool calls, reasoning, json-render specs, source-url parts —
      // intentionally dropped per the design.
    }
    const role: ExtractedMessage["role"] =
      msg.role === "user" || msg.role === "assistant" || msg.role === "system"
        ? msg.role
        : "assistant"
    const trimmed = textBuf.trim()
    if (trimmed) out.push({ role, text: trimmed })
  }

  return { messages: out, files, droppedFileCount }
}

function decodeDataUrl(
  url: string,
): { mediaType: string; bytes: Uint8Array } | null {
  // data:<mediatype>;base64,<payload>
  const m = url.match(/^data:([^;,]*);base64,(.*)$/i)
  if (!m) return null
  const mediaType = m[1] || "application/octet-stream"
  try {
    const binaryString = atob(m[2])
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return { mediaType, bytes }
  } catch {
    return null
  }
}

function guessFileName(url: string, mediaType?: string): string {
  // Best-effort extension from mediaType so the dropoff parser routes
  // correctly when the AI SDK didn't preserve the original filename.
  const ext = mediaType?.split("/")[1]?.split("+")[0] || "bin"
  void url
  return `attachment.${ext}`
}
