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
import { Trophy, XCircle } from "lucide-react"

export type PendingOutcome = {
  dealId: string
  dealName: string
  fromLabel: string
}

// Диалог исхода сделки при перетаскивании карточки в финальную колонку «Закрытие».
// Одна общая drop-зона; выбор Выиграно/Проиграно решает, на какую терминальную
// стадию (Closed / Rejected) уходит сделка. Комментарий необязателен и попадает
// в ленту решений вместе с переводом (moveDealStage, actor='user').
export function DealOutcomeDialog({
  outcome,
  pending,
  onConfirm,
  onCancel,
}: {
  outcome: PendingOutcome | null
  pending: boolean
  onConfirm: (result: "won" | "lost", note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState("")

  // Сброс комментария при смене сделки/закрытии — «adjust state during render».
  const key = outcome?.dealId ?? null
  const [prevKey, setPrevKey] = useState<string | null>(null)
  if (key !== prevKey) {
    setPrevKey(key)
    setNote("")
  }

  return (
    <Dialog
      open={outcome !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {outcome ? `Исход сделки: ${outcome.dealName}` : ""}
          </DialogTitle>
          <DialogDescription>
            {outcome
              ? `Закрытие сделки из «${outcome.fromLabel}» — это финальный этап. Выберите исход.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Комментарий (необязательно): причина, контекст…"
          className="min-h-20"
        />

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Отмена
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onConfirm("lost", note)}
              disabled={pending}
              className="border-[#242424]/40 text-[#242424] hover:bg-[#242424]/5 dark:border-[#8a8a90]/50 dark:text-[#D6D6DA] dark:hover:bg-[#3B3B40]/40"
            >
              <XCircle className="h-4 w-4 mr-1" />
              Не состоялось
            </Button>
            <Button
              onClick={() => onConfirm("won", note)}
              disabled={pending}
              className="bg-[#1F7A4D] text-white hover:bg-[#1a6a43]"
            >
              <Trophy className="h-4 w-4 mr-1" />
              Выиграно
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
