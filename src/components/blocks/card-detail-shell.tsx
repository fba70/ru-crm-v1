"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
  ArrowLeft,
  Building2,
  Check,
  Contact,
  FileText,
  Link2,
  ShoppingCart,
  Users,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import TaskEditDialog from "@/components/forms/form-task-edit"
import type { CardRow } from "@/app/api/cards/route"
import type {
  CardCategory,
  CardPriority,
  TaskPriority,
  TaskStatus,
} from "@/db/schema"

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
  support: "Поддержка",
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
  support: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
}

const PRIORITY_COLOR: Record<CardPriority, string> = {
  normal: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  high: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
}

const PRIORITY_GRADIENT: Record<CardPriority, string> = {
  normal:
    "bg-linear-to-b from-slate-200 via-slate-100/60 to-card dark:from-slate-500/50 dark:via-slate-800/30 dark:to-card",
  high: "bg-linear-to-b from-amber-100 via-amber-100/70 to-card dark:from-amber-600/40 dark:via-amber-900/30 dark:to-card",
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function CardDetailShell({ card }: { card: CardRow }) {
  const router = useRouter()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [isPending, startTransition] = useTransition()

  const resolved = card.accepted || !!card.rejectionReason
  const analysis = card.message?.analysis ?? ""
  const recommendation = card.message?.recommendation ?? ""

  // Prefill for the "create task from card" accept flow — see DashboardCard.
  const taskInitialValues = useMemo(
    () => ({
      name: CATEGORY_LABEL[card.category],
      description: recommendation,
      priority: (card.priority === "high" ? "high" : "medium") as TaskPriority,
      status: "todo" as TaskStatus,
    }),
    [card.category, card.priority, recommendation],
  )

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
        router.refresh()
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
        router.refresh()
      } catch {
        toast.error("Не удалось отклонить карточку")
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад к панели
        </Link>
        <div className="text-xs text-muted-foreground">
          Создано {formatDate(card.createdAt)}
        </div>
      </div>

      <Card className={cn("dark:border-gray-600", PRIORITY_GRADIENT[card.priority])}>
        <CardHeader>
          <CardTitle className="text-2xl">
            {CATEGORY_LABEL[card.category]}
          </CardTitle>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge className={PRIORITY_COLOR[card.priority]} variant="secondary">
              {PRIORITY_LABEL[card.priority]} приоритет
            </Badge>
            <Badge className={CATEGORY_COLOR[card.category]} variant="secondary">
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
        </CardHeader>

        <CardContent className="space-y-5 text-sm">
          {analysis && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Анализ
              </h3>
              <p className="whitespace-pre-wrap leading-relaxed">{analysis}</p>
            </section>
          )}
          {recommendation && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Рекомендация
              </h3>
              <p className="whitespace-pre-wrap leading-relaxed">
                {recommendation}
              </p>
            </section>
          )}
          {!analysis && !recommendation && (
            <p className="text-muted-foreground italic">Нет содержимого.</p>
          )}

          {card.rejectionReason && (
            <section className="rounded-md border border-red-300/50 bg-red-500/5 p-3 text-sm">
              <h3 className="font-semibold text-red-700 dark:text-red-300 mb-1">
                Причина отклонения
              </h3>
              <p className="text-muted-foreground whitespace-pre-wrap">
                {card.rejectionReason}
              </p>
            </section>
          )}

          {(card.clients.length > 0 ||
            card.contacts.length > 0 ||
            card.users.length > 0 ||
            card.ruleName ||
            card.sourceItemTitle) && (
            <section className="space-y-2 pt-2 border-t border-border/40 text-sm text-muted-foreground">
              {card.clients.length > 0 && (
                <div className="flex items-start gap-2">
                  <Building2 className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {card.clients.map((c) => (
                      <Badge key={c.id} variant="outline" className="font-normal">
                        {c.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {card.contacts.length > 0 && (
                <div className="flex items-start gap-2">
                  <Contact className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {card.contacts.map((c) => (
                      <Badge key={c.id} variant="outline" className="font-normal">
                        {c.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {card.users.length > 0 && (
                <div className="flex items-start gap-2">
                  <Users className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {card.users.map((u) => (
                      <Badge key={u.id} variant="outline" className="font-normal">
                        {u.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {card.ruleName && (
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 shrink-0" />
                  <span>Правило: {card.ruleName}</span>
                </div>
              )}
              {card.sourceItemTitle && (
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0" />
                  <span>Источник: {card.sourceItemTitle}</span>
                </div>
              )}
            </section>
          )}

          {card.category === "new_order" && (
            <div className="flex pt-3 border-t border-border/40">
              <Button
                asChild
                className="flex-1 bg-lime-600 text-white hover:bg-lime-600/90"
              >
                {/* → /products, where the New Order dialog opens prefilled with
                    the linked client + the verbatim client message. */}
                <Link href={`/products?orderFromCard=${card.id}`}>
                  <ShoppingCart className="h-4 w-4 mr-1" />
                  Создать заказ
                </Link>
              </Button>
            </div>
          )}

          {!resolved && (
            <div className="flex gap-2 pt-3 border-t border-border/40">
              {/* "Принять" opens the New Task dialog prefilled from this card;
                  the card is accepted only once the task is created. */}
              <TaskEditDialog
                mode="create"
                initialValues={taskInitialValues}
                onSuccess={handleAccept}
                trigger={
                  <Button disabled={isPending} className="flex-1">
                    <Check className="h-4 w-4 mr-1" />
                    Принять
                  </Button>
                }
              />
              <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={isPending}
                    className="flex-1"
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
        </CardContent>
      </Card>
    </div>
  )
}
