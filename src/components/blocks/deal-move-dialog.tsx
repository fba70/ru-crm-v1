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

// Диалог ручного перевода сделки между стадиями. Раньше вперёд требовал
// отметить хотя бы один «коммитмент» стадии, а назад — обязательную причину.
// Обязательные варианты убраны (созвон 17.10): вариантов в жизни гораздо
// больше, и «случайный тык» давал непредсказуемый результат. Остался один
// необязательный комментарий — просьба поделиться причиной, чтобы система
// лучше обучалась.
export function DealMoveDialog({
  move,
  pending,
  onConfirm,
  onCancel,
}: {
  move: PendingMove | null
  pending: boolean
  onConfirm: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState("")
  const isBack = move?.direction === "back"

  // Сброс комментария при смене сделки/цели (и при закрытии, когда move → null) —
  // паттерн «adjust state during render» вместо эффекта: React перерисует до
  // коммита, без каскадных рендеров.
  const moveKey = move ? `${move.dealId}:${move.toStageId}` : null
  const [prevKey, setPrevKey] = useState<string | null>(null)
  if (moveKey !== prevKey) {
    setPrevKey(moveKey)
    setNote("")
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
          {/* В заголовке — только название сделки; куда переносим, видно
              в подзаголовке «откуда → куда». */}
          <DialogTitle>{move?.dealName ?? ""}</DialogTitle>
          <DialogDescription>
            {/* Обратный перевод — стрелка справа налево: «Пилот ← КП». */}
            {move
              ? isBack
                ? `${move.toLabel} ← ${move.fromLabel}`
                : `${move.fromLabel} → ${move.toLabel}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            Расскажите, почему вы так решили — это поможет системе лучше
            обучиться (необязательно).
          </p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              isBack
                ? "Например: «КП недействительно, клиент сменил юрлицо»"
                : "Например: «Клиент согласовал бюджет и сроки»"
            }
            className="min-h-20"
          />
        </div>

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
          <Button onClick={() => onConfirm(note.trim())} disabled={pending}>
            {pending ? "Перевод…" : isBack ? "Перевести назад" : "Перевести"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
