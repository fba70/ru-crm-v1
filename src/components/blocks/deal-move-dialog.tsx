"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Lock } from "lucide-react"
import type { MoveDirection } from "@/lib/deal-board"

export type PendingMove = {
  dealId: string
  dealName: string
  toStageId: string
  fromLabel: string
  toLabel: string
  direction: MoveDirection
}

export function DealMoveDialog({
  move,
  pending,
  commitments = [],
  onConfirm,
  onCancel,
}: {
  move: PendingMove | null
  pending: boolean
  // Коммитменты целевой стадии (мок-конфиг). Для перевода ВПЕРЁД показываем
  // чек-лист «что подтвердил клиент»; ≥1 галочка разблокирует кнопку.
  commitments?: string[]
  onConfirm: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState("")
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const isBack = move?.direction === "back"

  // Сброс состояния при смене сделки/цели (и при закрытии, когда move → null) —
  // паттерн «adjust state during render» вместо эффекта: React перерисует до
  // коммита, без каскадных рендеров.
  const moveKey = move ? `${move.dealId}:${move.toStageId}` : null
  const [prevKey, setPrevKey] = useState<string | null>(null)
  if (moveKey !== prevKey) {
    setPrevKey(moveKey)
    setNote("")
    setChecked(new Set())
  }

  const hasCommitments = !isBack && commitments.length > 0
  const canConfirm = isBack
    ? note.trim().length >= 3
    : hasCommitments
      ? checked.size > 0
      : true

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  // Заметка-основание перевода: отмеченные коммитменты + свободный комментарий.
  function buildNote(): string {
    const parts: string[] = []
    if (hasCommitments && checked.size > 0) {
      const items = [...checked].sort((a, b) => a - b).map((i) => commitments[i])
      parts.push("Коммитменты: " + items.join("; "))
    }
    const c = note.trim()
    if (c) parts.push("«" + c + "»")
    return parts.join(". ")
  }

  return (
    <Dialog
      open={move !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {move
              ? isBack
                ? `Возврат: ${move.dealName}`
                : `${move.dealName} → ${move.toLabel}`
              : ""}
          </DialogTitle>
          <DialogDescription>
            {move
              ? isBack
                ? `Обратный перевод ${move.fromLabel} → ${move.toLabel}. Укажите основание (обязательно).`
                : hasCommitments
                  ? "Стадия — это коммитмент клиента. Отметьте, что клиент подтвердил."
                  : `Перевод ${move.fromLabel} → ${move.toLabel}. Комментарий по желанию.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {hasCommitments && (
          <div className="space-y-1.5">
            {commitments.map((c, i) => (
              <label
                key={i}
                className={`flex items-start gap-2 rounded-md border p-2.5 text-sm cursor-pointer transition-colors ${
                  checked.has(i)
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <Checkbox
                  checked={checked.has(i)}
                  onCheckedChange={() => toggle(i)}
                  className="mt-0.5"
                />
                <span>{c}</span>
              </label>
            ))}
          </div>
        )}

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            isBack
              ? "Что произошло? Например: «КП недействительно, клиент сменил юрлицо»"
              : "Комментарий (необязательно): источник, контекст…"
          }
          className="min-h-20"
        />

        <div className="flex gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Ручной перевод имеет приоритет: агент не изменит стадию без вашего
            подтверждения. Действие попадёт в ленту решений.
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Отмена
          </Button>
          <Button
            onClick={() => onConfirm(buildNote())}
            disabled={!canConfirm || pending}
          >
            {pending ? "Перевод…" : isBack ? "Перевести назад" : "Перевести"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
