"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
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
  ChevronDown,
  ChevronUp,
  Contact,
  FileText,
  Link2,
  ListTodo,
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
  action_required: "Нужен ответ",
  ambiguity: "Неоднозначность",
  data_intelligence: "Аналитика данных",
  momentum: "Динамика",
  log_only: "Только запись",
  new_order: "Новый заказ",
  support: "Поддержка",
}

// Статус-бейдж под приоритетом больше НЕ показывает категорию (она и так
// всегда в заголовке карточки — дублирование того же текста дважды читалось
// как баг: «бейдж пропал» воспринималось как «решение уже принято», хотя это
// просто была другая категория). Один цвет на все категории — бейдж отвечает
// только на вопрос «решение уже принято или нет», сам текст решения
// (Принята/Отклонена) задаётся прямо в месте использования. Красный — то же
// предупреждающее прочтение, что было у старого бейджа категории
// action_required («Требуется действие»), только теперь относится к ЛЮБОЙ
// нерешённой карточке, а не только к одной категории.
const STATUS_PENDING_COLOR = "bg-red-500/15 text-red-600 dark:text-red-300"

const PRIORITY_COLOR: Record<CardPriority, string> = {
  normal: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  high: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
}

// Same white bg-card surface as every other card grid in the app
// (client-card.tsx/task-card.tsx/contact-card.tsx/deal-kanban-card.tsx) —
// the page lost its outer white Card container, so a translucent tint would
// show the atmospheric page background through it instead of reading white.
// No -translate-y on hover (client-card.tsx dropped it: inside an
// overflow-y-auto scroll container the lift clipped the top row against the
// section's edge).
const CARD_SURFACE =
  "bg-card border-border shadow-sm transition-[box-shadow,background-color] duration-200 hover:shadow-lg hover:bg-card dark:hover:bg-secondary"

// A message field (Analysis / Recommendation) shown clamped to 3 lines on
// the card. The FULL text is only revealed via hover-card/click when it's
// actually clipped by the clamp — a short message that already fits in 3
// lines got the exact same hover popup showing the exact same text, which
// just read as a pointless duplicate tooltip. Truncation is detected by
// comparing the clamped element's scrollHeight (full content) against its
// clientHeight (clamped box) — the standard line-clamp overflow check.
function MessageField({
  label,
  text,
  highlight = false,
  noClamp = false,
}: {
  label: string
  text: string
  // Рекомендация — единственное поле карточки, которое требует действия от
  // оператора, поэтому визуально выделяется цветным блоком (в отличие от
  // «Анализ», который просто контекст).
  highlight?: boolean
  // Рекомендация теперь показывается ПОЛНОСТЬЮ, без клэмпа на 3 строки и
  // без hover-card — карточка и так скроллится по вертикали (см. CardContent
  // выше), так что обрезать текст незачем.
  noClamp?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (noClamp) return
    const el = ref.current
    if (!el) return
    const check = () => setTruncated(el.scrollHeight - el.clientHeight > 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, noClamp])

  const paragraph = (
    <p
      ref={ref}
      tabIndex={truncated ? 0 : undefined}
      onClick={truncated ? () => setOpen((o) => !o) : undefined}
      className={cn(
        "leading-relaxed whitespace-pre-wrap rounded -mx-1 px-1 transition-colors outline-hidden",
        !noClamp && "line-clamp-3",
        truncated && "cursor-pointer hover:bg-muted/40 focus:bg-muted/40",
      )}
    >
      {text}
    </p>
  )

  return (
    <div
      className={cn(
        highlight &&
          "rounded-md border border-blue-500/25 bg-blue-500/10 p-2 dark:border-blue-400/25 dark:bg-blue-400/10",
      )}
    >
      <div
        className={cn(
          "text-xs font-semibold uppercase tracking-wide mb-0.5",
          highlight
            ? "text-blue-700 dark:text-blue-300"
            : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      {truncated ? (
        <HoverCard
          open={open}
          onOpenChange={setOpen}
          openDelay={150}
          closeDelay={100}
        >
          <HoverCardTrigger asChild>{paragraph}</HoverCardTrigger>
          <HoverCardContent
            align="start"
            className="w-96 max-h-80 overflow-y-auto"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {label}
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {text}
            </p>
          </HoverCardContent>
        </HoverCard>
      ) : (
        paragraph
      )}
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
  onCreateOrder,
}: {
  card: CardRow
  onChanged: () => void
  // «Создать заказ» on a new_order card — when provided, opens the New Order
  // dialog right here on the dashboard instead of navigating to /products
  // first (see dashboard/page.tsx). Falls back to the old Link-based
  // navigation when omitted, so this component still works if ever reused
  // somewhere without that wiring.
  onCreateOrder?: (card: CardRow) => void
}) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [isPending, startTransition] = useTransition()

  const resolved = card.accepted || !!card.rejectionReason

  // Чевроны вместо градиентов-подсказок: кнопка видна только когда реально
  // есть куда скроллить в эту сторону (а не просто «на всякий случай»).
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const check = () => {
      setCanScrollUp(el.scrollTop > 1)
      setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 1)
    }
    check()
    el.addEventListener("scroll", check)
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", check)
      ro.disconnect()
    }
  }, [card])

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ top: direction * el.clientHeight, behavior: "smooth" })
  }

  const handleAccept = (taskId?: string) => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/cards", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: card.id,
            action: "accept",
            ...(taskId ? { resultTaskId: taskId } : {}),
          }),
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
        "flex flex-col h-120 gap-4 overflow-hidden",
        CARD_SURFACE,
        // Принятые/отклонённые карточки слегка темнее — читается как «уже
        // решено, внимания больше не требует», без ухода в неразличимость.
        // Светлая тема: --muted и так лишь чуть темнее --card (L 0.955 vs
        // 1.0) — этого достаточно. Тёмная тема: --muted (L 0.2738) почти
        // не отличается от --card (L 0.2938, разница вдвое меньше, чем в
        // светлой) — на тёмной теме решённая карточка читалась как
        // нерешённая. dark:bg-background берёт более тёмный токен страницы
        // (L 0.2321) вместо --muted, давая заметную разницу там, где не
        // хватало светлой темы. Непрозрачные цвета без альфы (не bg-muted/50)
        // — изначально это было ради честного перехода под градиент снизу,
        // но тот градиент заменили на чевроны (см. ниже), так что это условие
        // больше не обязательно, просто сохранили как есть.
        resolved && "bg-muted hover:bg-muted dark:bg-background dark:hover:bg-background",
      )}
    >
      <CardHeader className="pb-1.5 space-y-2">
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
            {/* Статус, не категория — категория уже в заголовке выше.
                Один и тот же текст/цвет для ЛЮБОЙ категории, пока карточка
                не решена; сменяется на Принята/Отклонена ниже. */}
            {!resolved && (
              <Badge className={STATUS_PENDING_COLOR} variant="secondary">
                Требуется решение
              </Badge>
            )}
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
        {/* Раньше overflow-hidden на всю CardContent молча ОБРЕЗАЛ
            содержимое, если анализ+рекомендация+причина отклонения+теги не
            влезали в фиксированную высоту карточки (h-120) — «Причина
            отклонения» могла визуально наехать на блок рекомендации прямо
            на границе обрезки. Теперь это отдельная скроллящаяся зона
            (scrollbar-none — скроллбар спрятан, скролл работает) с
            градиентом-подсказкой внизу, а не тихая обрезка. */}
        <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto scrollbar-none space-y-3 pt-4 pb-4"
        >
          {analysis && <MessageField label="Анализ" text={analysis} noClamp />}
          {recommendation && (
            <MessageField
              label="Рекомендация"
              text={recommendation}
              highlight
              noClamp
            />
          )}
          {!analysis && !recommendation && (
            <p className="text-muted-foreground italic">Нет содержимого.</p>
          )}

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
          <div className="space-y-1.5 text-xs text-muted-foreground">
            {card.clients.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  Компания
                </div>
                {/* Кликабельно — переход на карточку компании (звонок
                    18.09: «у меня контакт, но нелекабельный»). asChild +
                    Link, не onClick-навигация — обычная ссылка, средней
                    кнопкой можно открыть в новой вкладке. pl-[22px] =
                    ширина иконки (14px) + gap-2 (8px) над ней, чтобы чипы
                    начинались вровень с текстом заголовка, а не с иконки. */}
                <div className="flex flex-wrap gap-1 pl-[22px]">
                  {card.clients.map((c) => (
                    <Badge key={c.id} variant="outline" className="font-normal" asChild>
                      <Link href={`/clients?openClient=${c.id}`}>{c.name}</Link>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {card.contacts.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide">
                  <Contact className="h-3.5 w-3.5 shrink-0" />
                  Внешние контакты
                </div>
                {/* Кликабельно — есть карточка контакта, куда вести. */}
                <div className="flex flex-wrap gap-1 pl-[22px]">
                  {card.contacts.map((c) => (
                    <Badge key={c.id} variant="outline" className="font-normal" asChild>
                      <Link href={`/contacts?openContact=${c.id}`}>{c.name}</Link>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {card.users.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  Задействованные сотрудники
                </div>
                {/* Просто текстом, не чипами — некликабельно, в приложении
                    нет страницы профиля сотрудника, чтобы вести туда. */}
                <p className="pl-[22px]">{card.users.map((u) => u.name).join(", ")}</p>
              </div>
            )}
            {card.ruleName && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide">
                  <Link2 className="h-3.5 w-3.5 shrink-0" />
                  Правило
                </div>
                <p className="pl-[22px] truncate">{card.ruleName}</p>
              </div>
            )}
            {card.sourceItemTitle && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  Источник
                </div>
                <p className="pl-[22px] truncate">{card.sourceItemTitle}</p>
              </div>
            )}
          </div>
        )}
        </div>
        {/* Чевроны вместо градиентов — показывают, что есть что проскроллить,
            и сами скроллят по клику на высоту видимой области; колесо мыши
            продолжает работать как обычно. Видны только когда реально есть
            куда скроллить в эту сторону. */}
        {canScrollUp && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => scrollByPage(-1)}
            className="absolute left-1/2 top-0 -translate-x-1/2 rounded-full dark:hover:bg-input/60 dark:hover:text-foreground"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
        )}
        {canScrollDown && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => scrollByPage(1)}
            className="absolute left-1/2 bottom-0 -translate-x-1/2 rounded-full dark:hover:bg-input/60 dark:hover:text-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        )}
        </div>

        {/* Единая нижняя группа (одна mt-auto на весь блок, а не на каждый
            элемент по отдельности) — иначе несколько mt-auto-соседей делят
            свободное место пополам и между ними появляется незапланированный
            зазор вместо того, чтобы плотно прилипать к низу карточки. */}
        <div className="mt-auto flex flex-col gap-2 pt-2">
            {!resolved && (
            <div className="flex gap-2">
            {/* new_order cards swap "Принять" for "Создать заказ" in the
                exact same slot — the one recommendation on a new_order card
                IS "create the order", so a generic task made no sense there,
                and a THIRD button living inside the Рекомендация block (the
                earlier approach) looked bolted-on next to this row. One
                slot, one action per category, same visual rhythm either way. */}
            {card.category === "new_order" ? (
              onCreateOrder ? (
                // Opens the New Order dialog right on the dashboard,
                // prefilled with the linked client + the verbatim client
                // message (message.orderRequest) — see dashboard/page.tsx.
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:bg-emerald-400/15 dark:text-emerald-300 dark:hover:bg-emerald-400/25"
                  disabled={isPending}
                  onClick={() => onCreateOrder(card)}
                >
                  <ShoppingCart className="h-4 w-4 mr-1" />
                  Создать заказ
                </Button>
              ) : (
                <Button
                  asChild
                  size="sm"
                  variant="secondary"
                  className="flex-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:bg-emerald-400/15 dark:text-emerald-300 dark:hover:bg-emerald-400/25"
                >
                  {/* Fallback when no onCreateOrder is wired: hands the card
                      off to /products, where the New Order dialog opens
                      prefilled the same way. */}
                  <Link href={`/products?orderFromCard=${card.id}`}>
                    <ShoppingCart className="h-4 w-4 mr-1" />
                    Создать заказ
                  </Link>
                </Button>
              )
            ) : (
            <TaskEditDialog
              mode="create"
              initialValues={taskInitialValues}
              onSuccess={handleAccept}
              trigger={
                <Button
                  size="sm"
                  variant="secondary"
                  // Пастельный emerald — тот же тон и та же «мягкая» подложка
                  // (не сплошная заливка), что у бейджа «Принята», который
                  // сменяет эту кнопку после успешного принятия (визуальная
                  // преемственность); нет отдельного «success»-токена в
                  // палитре (--chart-1..5 — только синие + лосось, зелёного
                  // там вообще нет), поэтому взят тот же паттерн, что уже
                  // используется для этого состояния в остальном приложении.
                  className="flex-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:bg-emerald-400/15 dark:text-emerald-300 dark:hover:bg-emerald-400/25"
                  disabled={isPending}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Принять
                </Button>
              }
            />
            )}
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
            {/* Куда ведёт принятие рекомендации — задача или заказ, смотря
                что реально создалось (см. handleAccept / onCreateOrder выше,
                resultTaskId/resultOrderId стамповаются в момент создания). */}
            {resolved && (card.resultTaskId || card.resultOrderId) && (
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="w-full justify-start text-muted-foreground hover:text-foreground"
              >
                {card.resultTaskId ? (
                  <Link href={`/tasks?openTask=${card.resultTaskId}`}>
                    <ListTodo className="h-4 w-4 mr-1" />
                    Открыть задачу
                  </Link>
                ) : (
                  <Link href={`/products?openOrder=${card.resultOrderId}`}>
                    <ShoppingCart className="h-4 w-4 mr-1" />
                    Открыть заказ
                  </Link>
                )}
              </Button>
            )}

        </div>
      </CardContent>
    </Card>
  )
}
