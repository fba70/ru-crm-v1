"use client"

import { useMemo, useState, useTransition } from "react"
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
  TaskType,
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

// Хью взяты из палитры доски сделок («драгоценные тона», src/lib/deal-board.ts
// STAGE_COLOR + бейджи deal-kanban-card.tsx), а не разрозненного набора Tailwind-
// цветов — чтобы Домашняя читалась как часть того же продукта, что и Сделки.
const CATEGORY_COLOR: Record<CardCategory, string> = {
  client_activity: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  colleagues_activity: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  business_info: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  action_required:
    "bg-[#C1121F]/10 text-[#A31018] dark:bg-[#C1121F]/15 dark:text-[#FF8F96]",
  ambiguity: "bg-[#C2410C]/15 text-[#C2410C] dark:text-[#E5824A]",
  data_intelligence: "bg-[#294A6B]/15 text-[#294A6B] dark:text-[#8FB4D9]",
  momentum: "bg-teal-500/15 text-teal-600 dark:text-teal-300",
  log_only: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  new_order: "bg-[#1F7A4D]/15 text-[#1F7A4D] dark:text-[#5BD69A]",
  support: "bg-[#669BBC]/20 text-[#2F5D77] dark:text-[#9FC4DC]",
}

const PRIORITY_COLOR: Record<CardPriority, string> = {
  normal: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  high: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
}

// Same surface + hover treatment as the Companies card (client-card.tsx) —
// unified look/feel across the app's card grids. No -translate-y on hover
// here either (client-card.tsx dropped it: inside an overflow-y-auto scroll
// container the lift clipped the top row against the section's edge).
const CARD_SURFACE =
  "bg-[#FDF0D5]/[0.05] border-muted shadow-sm transition-[box-shadow,background-color] duration-200 hover:shadow-lg hover:bg-[#FDF0D5]/[0.09] dark:bg-[#FDF0D5]/[0.045] dark:hover:bg-[#FDF0D5]/[0.08]"

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

  // Accepting a card spawns a task prefilled from it: name = the LLM-summarised
  // task title (falls back to the category label on older cards),
  // description = recommendation, priority high→high / normal→medium, status
  // "to do", due today. Assignee defaults to the current user (the task dialog
  // seeds it from the first org member). Client + contact come from the card's
  // identified links: the contact's owning client is preferred so the task
  // form's client-scoped contact picker keeps the contact selected; otherwise
  // the first linked client is used (contact left empty, since the form would
  // drop a contact that doesn't belong to the chosen client). Memoized so the
  // dialog's reset effect keeps a stable reference.
  const taskInitialValues = useMemo(() => {
    const linkedContact = card.contacts[0] ?? null
    const clientId =
      linkedContact?.clientId ?? card.clients[0]?.id ?? undefined
    const contactId =
      linkedContact && linkedContact.clientId === clientId
        ? linkedContact.id
        : undefined
    return {
      name: card.message?.taskTitle?.trim() || CATEGORY_LABEL[card.category],
      description: recommendation,
      priority: (card.priority === "high" ? "high" : "medium") as TaskPriority,
      status: "todo" as TaskStatus,
      // A support card spawns a customer-support task; other cards leave the
      // type to the form default.
      ...(card.category === "support" ? { type: "support" as TaskType } : {}),
      ...(clientId ? { clientId } : {}),
      ...(contactId ? { contactId } : {}),
    }
  }, [
    card.category,
    card.priority,
    card.message?.taskTitle,
    card.clients,
    card.contacts,
    recommendation,
  ])

  return (
    <Card
      className={cn(
        // Fixed height keeps the grid uniform. Sized to fit header +
        // analysis (3 lines) + recommendation (3 lines) + refs + pinned
        // action row without forcing line-clamp across the card boundary,
        // while staying tight enough that short cards don't leave a big
        // gap above the footer group.
        "flex flex-col h-120 overflow-hidden",
        CARD_SURFACE,
      )}
    >
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base min-w-0 flex-1 truncate">
            {CATEGORY_LABEL[card.category]}
          </CardTitle>
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
          card.contacts.length > 0 ||
          card.users.length > 0 ||
          card.ruleName ||
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
            {card.contacts.length > 0 && (
              <div className="flex items-start gap-2">
                <Contact className="h-3.5 w-3.5 shrink-0 mt-0.5" />
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
            {card.ruleName && (
              <div className="flex items-center gap-2 truncate">
                <Link2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Правило: {card.ruleName}</span>
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

        {/* Единая нижняя группа (одна mt-auto на весь блок, а не на каждый
            элемент по отдельности) — иначе несколько mt-auto-соседей делят
            свободное место пополам и между ними появляется незапланированный
            зазор вместо того, чтобы плотно прилипать к низу карточки. */}
        <div className="mt-auto flex flex-col gap-2 pt-2">
          {(card.category === "new_order" || !resolved) && (
          <div className="flex flex-col gap-2">
            {card.category === "new_order" && (
              <Button asChild size="sm" variant="outline">
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
            {/* "Принять" opens the New Task dialog prefilled from this card.
                The card is marked accepted only once the task is actually
                created (onSuccess → handleAccept); cancelling leaves it open. */}
            <TaskEditDialog
              mode="create"
              initialValues={taskInitialValues}
              onSuccess={handleAccept}
              trigger={
                <Button
                  size="sm"
                  variant="secondary"
                  // bg-secondary (dark: oklch 0.33) sits almost on top of the
                  // card background (oklch 0.29) in dark theme — bumped to
                  // the lighter --accent token in dark mode only so the
                  // button stays readable without turning it red/primary.
                  className="flex-1 dark:bg-accent dark:text-accent-foreground dark:hover:bg-accent/80"
                  disabled={isPending}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Принять
                </Button>
              }
            />
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

        </div>
      </CardContent>
    </Card>
  )
}
