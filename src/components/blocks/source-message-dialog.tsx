"use client"

import { useEffect, useState } from "react"
import { Loader } from "lucide-react"
import { Streamdown } from "streamdown"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Достаёт из распарсенного markdown только сам текст сообщения: без YAML
// frontmatter (это служебные данные разбора) и без LLM-«## Summary». Шаблон
// документа — `---yaml--- / ## Summary / ## Content`, см. parsers/_shared.ts.
export function messageBodyFromParsed(md: string): string {
  const body = md.replace(/^---\n[\s\S]*?\n---\n?/, "")
  const content = body.match(/^##\s+Content\s*\n([\s\S]*)$/m)
  if (content) return content[1].trim()
  return body.replace(/^##\s+Summary\s*\n[\s\S]*?(?=^##\s)/m, "").trim()
}

// Окно «исходник карточки»: как письмо/сообщение выглядит для человека —
// от кого, кому, когда и текст. Шапка (заголовок + поля + крестик)
// закреплена, прокручивается только текст.
export function SourceMessageDialog({
  itemId,
  open,
  onOpenChange,
  title,
  channel,
  from,
  to,
  date,
}: {
  itemId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  channel: string | null
  from: string | null
  to: string | null
  date: string | null
}) {
  const [body, setBody] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = open && itemId !== null && body === null && error === null

  useEffect(() => {
    if (!open || !itemId) return
    let cancelled = false
    fetch(`/api/sources/items/${itemId}/markdown`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || typeof data.markdown !== "string") {
          setError(data.error || "Не удалось загрузить источник")
        } else {
          setBody(messageBodyFromParsed(data.markdown))
        }
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить источник")
      })
    return () => {
      cancelled = true
    }
  }, [open, itemId])

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setBody(null)
      setError(null)
    }
    onOpenChange(next)
  }

  const fields = [
    { label: "От", value: from },
    { label: "Кому", value: to },
    { label: "Дата", value: date },
    { label: "Канал", value: channel },
  ].filter((f): f is { label: string; value: string } => !!f.value)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 space-y-3 border-b p-6 pr-12 text-left">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription asChild>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {fields.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="min-w-0 break-words text-foreground">
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader className="h-4 w-4 animate-spin" />
              Загрузка…
            </div>
          )}
          {error && <p className="py-4 text-sm text-destructive">{error}</p>}
          {body !== null &&
            (body ? (
              <div className="text-sm wrap-break-word [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_img]:h-auto [&_img]:max-w-full">
                <Streamdown>{body}</Streamdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Текста нет.</p>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
