"use client"

import Link from "next/link"
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
  Pencil,
  MessageSquare,
  Clock,
  Briefcase,
  ListTodo,
} from "lucide-react"
import type {
  ClientRow,
  ClientRevenueSummary,
  ClientTaskSummary,
} from "@/app/api/clients/route"
import type { DealRow } from "@/app/api/deals/route"
import ClientEditDialog from "@/components/forms/form-client-edit"
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
  taskSummary,
}: {
  client: ClientRow
  onChanged: () => void
  // When true (owner), show the "add to blocklist" action.
  canBlock?: boolean
  revenue?: ClientRevenueSummary
  activeDeal?: DealRow
  taskSummary?: ClientTaskSummary
}) {
  const preview = client.contacts.slice(0, 2)
  const moreCount = Math.max(0, client.contacts.length - preview.length)

  return (
    <Card
      className={`flex flex-col ${
        client.status === "deleted" || client.status === "blocked"
          ? "opacity-60"
          : ""
      }`}
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
          <ClientEditDialog
            mode="edit"
            client={client}
            onSuccess={onChanged}
            trigger={
              <Button variant="ghost" size="icon" aria-label="Редактировать компанию">
                <Pencil className="h-4 w-4" />
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

        {taskSummary && taskSummary.openCount > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ListTodo className="h-3.5 w-3.5 shrink-0" />
              {taskSummary.openCount}{" "}
              {taskSummary.openCount === 1 ? "задача" : "задач"}
            </span>
            {taskSummary.overdueCount > 0 && (
              <span className="font-medium text-[#A31018] dark:text-[#FF8F96]">
                {taskSummary.overdueCount} просрочено
              </span>
            )}
          </div>
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
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href={`/clients/${client.id}`}>
              Подробнее
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
