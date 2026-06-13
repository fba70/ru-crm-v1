"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  Building2,
  Check,
  FileText,
  ShoppingCart,
  Users,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { CardRow } from "@/app/api/cards/route"
import type { CardCategory, CardPriority } from "@/db/schema"

const PRIORITY_LABEL: Record<CardPriority, string> = {
  normal: "Обычный",
  high: "Высокий",
}

const CATEGORY_LABEL: Record<CardCategory, string> = {
  client_activity: "Активность клиента",
  colleagues_activity: "Активность коллег",
  business_info: "Бизнес-информация",
  action_required: "Требуется действие",
  ambiguity: "Неоднозначность",
  data_intelligence: "Аналитика данных",
  momentum: "Динамика",
  log_only: "Только запись",
  new_order: "Новый заказ",
}

const CATEGORY_COLOR: Record<CardCategory, string> = {
  client_activity: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  colleagues_activity: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  business_info: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  action_required: "bg-red-500/15 text-red-600 dark:text-red-300",
  ambiguity: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  data_intelligence: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  momentum: "bg-teal-500/15 text-teal-600 dark:text-teal-300",
  log_only: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  new_order: "bg-lime-500/15 text-lime-700 dark:text-lime-300",
}

const PRIORITY_COLOR: Record<CardPriority, string> = {
  normal: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  high: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
}

// Vertical gradient: silver for normal, gold for high. Fades into the
// standard card surface so the card body remains readable.
const PRIORITY_GRADIENT: Record<CardPriority, string> = {
  normal:
    "bg-linear-to-b from-slate-200 via-slate-100/60 to-card dark:from-slate-500/50 dark:via-slate-800/30 dark:to-card",
  high: "bg-linear-to-b from-amber-100 via-amber-100/70 to-card dark:from-amber-600/40 dark:via-amber-900/30 dark:to-card",
}

// A message field (Analysis / Recommendation) shown clamped to 3 lines on
// the card, with the FULL text revealed in a hover-card on hover, keyboard
// focus, or click — so long messages are readable without opening the card
// details page. The content is portaled, so it escapes the card's fixed
// height + overflow-hidden.
function MessageField({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </div>
      <HoverCard
        open={open}
        onOpenChange={setOpen}
        openDelay={150}
        closeDelay={100}
      >
        <HoverCardTrigger asChild>
          <p
            tabIndex={0}
            onClick={() => setOpen((o) => !o)}
            className="leading-relaxed line-clamp-3 whitespace-pre-wrap cursor-pointer rounded -mx-1 px-1 transition-colors hover:bg-muted/40 focus:bg-muted/40 outline-hidden"
          >
            {text}
          </p>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          className="w-96 max-h-80 overflow-y-auto"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            {label}
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function DashboardCard({
  card,
  onChanged,
}: {
  card: CardRow
  onChanged: () => void
}) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [isPending, startTransition] = useTransition()

  const resolved = card.accepted || !!card.rejectionReason

  const handleAccept = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/cards", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: card.id, action: "accept" }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось принять карточку")
          return
        }
        toast.success("Карточка принята")
        onChanged()
      } catch {
        toast.error("Не удалось принять карточку")
      }
    })
  }

  const handleReject = () => {
    if (!rejectReason.trim()) {
      toast.error("Укажите причину отклонения")
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/cards", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: card.id,
            action: "reject",
            rejectionReason: rejectReason.trim(),
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось отклонить карточку")
          return
        }
        toast.success("Карточка отклонена")
        setRejectOpen(false)
        setRejectReason("")
        onChanged()
      } catch {
        toast.error("Не удалось отклонить карточку")
      }
    })
  }

  const analysis = card.message?.analysis ?? ""
  const recommendation = card.message?.recommendation ?? ""

  return (
    <Card
      className={cn(
        // Fixed height keeps the grid uniform. Sized to fit header +
        // analysis (3 lines) + recommendation (3 lines) + refs + pinned
        // action row without forcing line-clamp across the card boundary,
        // while staying tight enough that short cards don't leave a big
        // gap between the source ref and the action row.
        "flex flex-col h-120 dark:border-gray-600 overflow-hidden",
        PRIORITY_GRADIENT[card.priority],
      )}
    >
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base min-w-0 flex-1 truncate">
            {CATEGORY_LABEL[card.category]}
          </CardTitle>
          <Link href={`/cards/${card.id}`} className="shrink-0">
            <Button variant="outline" size="sm">
              Подробнее
            </Button>
          </Link>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex flex-wrap gap-1.5 min-w-0">
            <Badge
              className={PRIORITY_COLOR[card.priority]}
              variant="secondary"
            >
              {PRIORITY_LABEL[card.priority]} приоритет
            </Badge>
            <Badge
              className={CATEGORY_COLOR[card.category]}
              variant="secondary"
            >
              {CATEGORY_LABEL[card.category]}
            </Badge>
            {card.accepted && (
              <Badge
                variant="secondary"
                className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              >
                Принята
              </Badge>
            )}
            {card.rejectionReason && (
              <Badge
                variant="secondary"
                className="bg-red-500/15 text-red-700 dark:text-red-300"
              >
                Отклонена
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {formatDate(card.createdAt)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 flex flex-col gap-3 text-sm overflow-hidden">
        <div className="space-y-2 min-h-0">
          {analysis && <MessageField label="Анализ" text={analysis} />}
          {recommendation && (
            <MessageField label="Рекомендация" text={recommendation} />
          )}
          {!analysis && !recommendation && (
            <p className="text-muted-foreground italic">Нет содержимого.</p>
          )}
        </div>

        {card.rejectionReason && (
          <div className="rounded-md border border-red-300/50 bg-red-500/5 p-2 text-xs">
            <div className="font-semibold text-red-700 dark:text-red-300 mb-0.5">
              Причина отклонения
            </div>
            <div className="text-muted-foreground line-clamp-2">
              {card.rejectionReason}
            </div>
          </div>
        )}

        {(card.clients.length > 0 ||
          card.users.length > 0 ||
          card.sourceItemTitle) && (
          <div className="space-y-1.5 text-xs text-muted-foreground pt-1 border-t border-border/40">
            {card.clients.length > 0 && (
              <div className="flex items-start gap-2">
                <Building2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div className="flex flex-wrap gap-1">
                  {card.clients.map((c) => (
                    <Badge key={c.id} variant="outline" className="font-normal">
                      {c.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {card.users.length > 0 && (
              <div className="flex items-start gap-2">
                <Users className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div className="flex flex-wrap gap-1">
                  {card.users.map((u) => (
                    <Badge key={u.id} variant="outline" className="font-normal">
                      {u.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {card.sourceItemTitle && (
              <div className="flex items-center gap-2 truncate">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Источник: {card.sourceItemTitle}</span>
              </div>
            )}
          </div>
        )}

        {(card.category === "new_order" || !resolved) && (
          <div className="flex flex-col gap-2 pt-2 mt-auto">
            {card.category === "new_order" && (
              <Button
                asChild
                size="sm"
                className="bg-lime-600 text-white hover:bg-lime-600/90"
              >
                {/* Hands the card off to /products, where the New Order dialog
                    opens prefilled with the linked client + the verbatim
                    client message (message.orderRequest). */}
                <Link href={`/products?orderFromCard=${card.id}`}>
                  <ShoppingCart className="h-4 w-4 mr-1" />
                  Создать заказ
                </Link>
              </Button>
            )}
            {!resolved && (
            <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={handleAccept}
              disabled={isPending}
            >
              <Check className="h-4 w-4 mr-1" />
              Принять
            </Button>
            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={isPending}
                >
                  <X className="h-4 w-4 mr-1" />
                  Отклонить
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Отклонить карточку</DialogTitle>
                  <DialogDescription>
                    Укажите краткую причину. Она сохранится вместе с карточкой,
                    чтобы команда видела, почему её отклонили.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Почему вы отклоняете эту карточку?"
                  rows={4}
                  autoFocus
                />
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setRejectOpen(false)}
                    disabled={isPending}
                  >
                    Отмена
                  </Button>
                  <Button
                    onClick={handleReject}
                    disabled={isPending || !rejectReason.trim()}
                  >
                    Отклонить карточку
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
