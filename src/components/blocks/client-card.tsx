"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ArrowRight,
  MapPin,
  Globe,
  MessageSquare,
  Clock,
  Briefcase,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import type { ClientRow, ClientRevenueSummary } from "@/app/api/clients/route"
import type { DealRow } from "@/app/api/deals/route"
import type { TaskRow } from "@/app/api/tasks/route"
import { ClientLookupDialog } from "@/components/blocks/client-lookup-dialog"
import { BlacklistEntityButton } from "@/components/blocks/client-blocklist-dialog"
import { formatAmount, formatCompactNumber, CURRENCY_SYMBOL } from "@/lib/deal-board"
import { dealStageLabel } from "@/lib/deal-funnel"
import {
  clientAtRisk,
  clientStaleDays,
  pluralizeOrders,
} from "@/lib/client-mocks"
import { COMPANY_KIND_LABELS } from "@/lib/client-custom-fields"

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

// Тот же бейдж-язык, что и для статуса (насыщенные хью deal-board.ts).
const COMPANY_KIND_COLOR: Record<string, string> = {
  supplier: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  partner: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
}

// `initial` is the auto-discovered state — give it a distinct accent so
// it stands out for review. `suspended` stays muted (archived). `deleted`
// is the soft-delete (excluded from discovery) — red accent + the card is
// dimmed below.
// Хью — те же, что уже использует доска сделок (src/lib/deal-board.ts +
// deal-kanban-card.tsx), а не разрозненные Tailwind-цвета.
const STATUS_COLOR: Record<string, string> = {
  initial: "bg-[#C2410C]/15 text-[#C2410C] dark:text-[#E5824A]",
  suspended: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  deleted: "bg-red-500/15 text-red-600 dark:text-red-300",
  blocked: "bg-[#C1121F]/10 text-[#A31018] dark:bg-[#C1121F]/15 dark:text-[#FF8F96]",
}

// UI display labels for the status badge (DB enum values stay English).
const STATUS_LABEL: Record<string, string> = {
  active: "Активный",
  initial: "Новый",
  suspended: "Приостановлен",
  deleted: "Удалён",
  blocked: "Заблокирован",
}

// Блок аккаунт-менеджмента (UX со звонка 14.08): выручка за 12 мес., активная
// сделка, риск «давно не было контакта» — то, ради чего вообще открывают
// карточку компании, а не адрес/директор.
export function AccountSummary({
  client,
  revenue,
  activeDeal,
}: {
  client: ClientRow
  revenue?: ClientRevenueSummary
  activeDeal?: DealRow
}) {
  const days = clientStaleDays(client.updatedAt)
  const stale = clientAtRisk(client.updatedAt)
  const symbol = (
    CURRENCY_SYMBOL[client.currency.toUpperCase()] ?? client.currency
  ).trim()
  const dealAmount = activeDeal
    ? formatAmount(activeDeal.value, activeDeal.currency)
    : null

  return (
    <div className="rounded-md border border-border bg-muted p-2.5 space-y-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Выручка за 12 мес.
        </span>
        <span className="font-semibold tabular-nums">
          {revenue && revenue.revenue > 0
            ? `${formatCompactNumber(revenue.revenue)} ${symbol} · ${revenue.orders} ${pluralizeOrders(revenue.orders)}`
            : "нет заказов"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
          <Briefcase className="h-3 w-3 shrink-0" />
          {activeDeal ? activeDeal.name : "Нет активной сделки"}
        </span>
        {activeDeal && (
          <span className="text-xs shrink-0 text-right">
            {dealStageLabel(activeDeal.funnelStageName)}
            {dealAmount ? ` · ${dealAmount}` : ""}
          </span>
        )}
      </div>
      {stale && (
        // Тот же визуальный язык, что «остывание» на карточке сделки
        // (deal-kanban-card.tsx) — Clock-бейдж + тултип по наведению.
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="inline-flex cursor-help"
              aria-label="Давно не было контакта"
            >
              <Badge
                variant="secondary"
                className="gap-1 bg-[#C1121F]/10 text-[#A31018] dark:bg-[#C1121F]/15 dark:text-[#FF8F96]"
              >
                <Clock className="h-3 w-3" />
                {days} дн без контакта
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent align="start" className="max-w-xs text-xs">
            Компания давно не касалась ни одной записи в системе — возможно,
            стоит связаться.
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

export function ClientCard({
  client,
  onChanged,
  canBlock = false,
  revenue,
  activeDeal,
  tasks = [],
  tasksLoaded = true,
  onOpenDetail,
}: {
  client: ClientRow
  onChanged: () => void
  // When true (owner), show the "add to blocklist" action.
  canBlock?: boolean
  revenue?: ClientRevenueSummary
  activeDeal?: DealRow
  // Задачи компании (любой статус, createdAt desc) — плашка листает их по
  // одной, тот же виджет, что и на карточках сделок (deal-kanban-card.tsx).
  tasks?: TaskRow[]
  // Пока родитель ещё грузит задачи, не показываем «Задач нет» — иначе на
  // миг мелькнёт ложное «пусто» до прихода реальных данных.
  tasksLoaded?: boolean
  onOpenDetail: (clientId: string) => void
}) {
  const preview = client.contacts.slice(0, 2)
  const moreCount = Math.max(0, client.contacts.length - preview.length)

  const [taskIdx, setTaskIdx] = useState(0)
  const taskCount = tasks.length
  const safeTaskIdx = taskCount ? Math.min(taskIdx, taskCount - 1) : 0
  const currentTask = tasks[safeTaskIdx] ?? null

  return (
    <Card
      className={cn(
        // Слегка светлее дефолтного data-slot="card" (тёплая примесь того же
        // кремового акцента, что и на карточках сделок в канбане, чтобы
        // карточка не сливалась с атмосферным фоном страницы), + при
        // наведении подсвечивается тенью/рамкой/подложкой (тот же язык, что
        // deal-kanban-card.tsx). БЕЗ сдвига вверх (-translate-y) — в отличие
        // от карточки сделки, эта карточка сидит в скролл-контейнере
        // (CardContent overflow-y-auto), и сдвиг верхнего ряда обрезался
        // верхней границей секции при скролле в начало.
        "flex flex-col bg-[#FDF0D5]/[0.05] border-muted shadow-sm transition-[box-shadow,background-color] duration-200 hover:shadow-lg hover:bg-[#FDF0D5]/[0.09] dark:bg-[#FDF0D5]/[0.045] dark:hover:bg-[#FDF0D5]/[0.08]",
        (client.status === "deleted" || client.status === "blocked") &&
          "opacity-60",
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{client.name}</CardTitle>
          {client.namePhys && (
            <div className="text-sm text-muted-foreground truncate">
              {client.namePhys}
            </div>
          )}
          {/* Funnel-phase badge intentionally hidden for now — only the
              non-active status + company-kind badges are shown. */}
          {(client.status !== "active" || client.customFields?.companyKind) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {client.status !== "active" && (
                <Badge
                  variant="secondary"
                  className={STATUS_COLOR[client.status] ?? ""}
                >
                  {STATUS_LABEL[client.status] ?? client.status}
                </Badge>
              )}
              {client.customFields?.companyKind && (
                <Badge
                  variant="secondary"
                  className={
                    COMPANY_KIND_COLOR[client.customFields.companyKind] ?? ""
                  }
                >
                  {COMPANY_KIND_LABELS[client.customFields.companyKind]}
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ClientLookupDialog
            client={client}
            onSaved={onChanged}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Поиск в интернете"
                title="Поиск в интернете"
              >
                <Globe className="h-4 w-4" />
              </Button>
            }
          />
          {canBlock && client.status !== "blocked" && (
            <BlacklistEntityButton
              entityType="client"
              id={client.id}
              name={client.name}
              onBlocked={onChanged}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-3 text-sm">
        <AccountSummary
          client={client}
          revenue={revenue}
          activeDeal={activeDeal}
        />

        {/* Задачи — тот же виджет, что на карточках сделок: заголовок снаружи
            плашки («Задача»/«Задачи N» + шевроны для листания), внутри —
            имя + исполнитель текущей задачи. */}
        {currentTask ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {taskCount > 1 ? `Задачи ${taskCount}` : "Задача"}
              </div>
              {taskCount > 1 && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4"
                    aria-label="Предыдущая задача"
                    disabled={safeTaskIdx === 0}
                    onPointerDown={stop}
                    onClick={(e) => {
                      stop(e)
                      setTaskIdx((i) => Math.max(0, i - 1))
                    }}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4"
                    aria-label="Следующая задача"
                    disabled={safeTaskIdx >= taskCount - 1}
                    onPointerDown={stop}
                    onClick={(e) => {
                      stop(e)
                      setTaskIdx((i) => Math.min(taskCount - 1, i + 1))
                    }}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
            <div className="rounded-md border border-border bg-muted p-2 space-y-1">
              <div className="truncate text-xs text-foreground">
                {currentTask.name}
              </div>
              {currentTask.assigneeName && (
                <div className="truncate text-[11px] text-muted-foreground">
                  Исполнитель: {currentTask.assigneeName}
                </div>
              )}
            </div>
          </div>
        ) : (
          tasksLoaded && (
            <div className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Задач нет
            </div>
          )
        )}

        {/* Email/телефон — только на /clients/[id], не на компактной карточке. */}

        {/* Адрес/сайт/комментарий — второстепенная справочная информация,
            свёрнута по умолчанию (это не то, ради чего открывают карточку
            компании — см. обсуждение аккаунт-менеджмента). */}
        {(client.address || client.webUrl || client.comment) && (
          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer select-none hover:text-foreground">
              Ещё о компании
            </summary>
            <div className="mt-1.5 space-y-1">
              {client.address && (
                <div className="flex items-center gap-2 truncate">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{client.address}</span>
                </div>
              )}
              {client.webUrl && (
                <div className="flex items-center gap-2 truncate">
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <a
                    href={client.webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate hover:underline text-[#2F5D77] dark:text-[#9FC4DC]"
                  >
                    {client.webUrl}
                  </a>
                </div>
              )}
              {client.comment && (
                <div className="flex items-start gap-2">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span className="line-clamp-2">{client.comment}</span>
                </div>
              )}
            </div>
          </details>
        )}

        {client.contacts.length > 0 && (
          <div className="rounded-md border p-2 space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              Контакты ({client.contacts.length})
            </div>
            {preview.map((c) => (
              <div key={c.id} className="text-sm truncate">
                <span className="font-medium">{c.nameNative || c.name}</span>
                {c.position && (
                  <span className="text-muted-foreground"> — {c.position}</span>
                )}
              </div>
            ))}
            {moreCount > 0 && (
              <div className="text-xs text-muted-foreground">
                +{moreCount} ещё (откройте, чтобы посмотреть)
              </div>
            )}
          </div>
        )}

        {/* Spacer pushes the creator/details row to the bottom of the card so
            it stays aligned across cards of different content height. */}
        <div className="flex-1" aria-hidden />
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground truncate">
            {client.userName ? `Кто создал: ${client.userName}` : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => onOpenDetail(client.id)}
          >
            Подробнее
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
