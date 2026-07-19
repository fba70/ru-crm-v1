"use client"

import { useState } from "react"
import { Sparkles, Undo2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { Confidence, DealProposal } from "@/server/deals-mock"

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "низкая уверенность",
  medium: "средняя уверенность",
  high: "высокая уверенность",
}

export function DealProposalGhost({
  proposal,
  pending,
  onAccept,
  onReject,
}: {
  proposal: DealProposal
  pending: boolean
  onAccept: (id: string) => void
  onReject: (id: string, reason: string) => void
}) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState("")

  const isBack = proposal.direction === "back"
  const Icon = isBack ? Undo2 : Sparkles
  const headerText = isBack
    ? `Возврат: ${proposal.fromLabel} → ${proposal.toLabel}`
    : `Предложение: ${proposal.fromLabel} → ${proposal.toLabel}`

  return (
    <Card
      className={cn(
        "gap-2 space-y-2 border border-dashed p-3 shadow-none",
        isBack
          ? "border-amber-500/60 bg-amber-500/5"
          : "border-violet-500/60 bg-violet-500/5",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          isBack
            ? "text-amber-600 dark:text-amber-300"
            : "text-violet-600 dark:text-violet-300",
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{headerText}</span>
      </div>

      <div className="text-sm font-medium leading-snug">{proposal.dealName}</div>

      <div className="text-xs text-muted-foreground leading-snug">
        {proposal.why} · {proposal.source} ·{" "}
        {CONFIDENCE_LABEL[proposal.confidence]}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => onAccept(proposal.id)}
          disabled={pending}
        >
          Принять
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRejectOpen(true)}
          disabled={pending}
        >
          Отклонить
        </Button>
      </div>

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open)
          if (!open) setReason("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отклонить предложение</DialogTitle>
          </DialogHeader>

          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Почему предложение неверно? Причина попадёт в контекст агента для этой организации."
            className="min-h-24"
          />

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectOpen(false)
                setReason("")
              }}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onReject(proposal.id, reason.trim())
                setRejectOpen(false)
                setReason("")
              }}
              disabled={pending}
            >
              Отклонить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
