"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Mail, Phone, Briefcase, Building2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ContactRow } from "@/app/api/contacts/route"

// `initial` is the auto-discovered state — accent for review attention.
// `suspended` stays muted (archived). `deleted` is the soft-delete (excluded
// from discovery) — red accent + dimmed card. `blocked` is the blocklist
// suppression. Mirrors the same palette as the client card — hues from the
// deals board (src/lib/deal-board.ts + deal-kanban-card.tsx), not ad-hoc
// Tailwind colors.
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

// Клик по всей карточке открывает <ContactDetailDrawer> — как у <ClientCard>,
// поэтому отдельной кнопки редактирования на карточке больше нет (звонок
// 18.09 + правки после него).
export function ContactCard({
  contact,
  onOpenDetail,
}: {
  contact: ContactRow
  onOpenDetail: (contactId: string) => void
}) {
  return (
    <Card
      onClick={() => onOpenDetail(contact.id)}
      className={cn(
        // Тот же белый фон, что у карточек сделок — единый язык карточек.
        "flex flex-col cursor-pointer bg-card border-border shadow-sm transition-[box-shadow,background-color] duration-200 hover:shadow-lg hover:bg-card dark:hover:bg-secondary",
        (contact.status === "deleted" || contact.status === "blocked") &&
          "opacity-60",
      )}
    >
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">
            {contact.nameNative || contact.name}
          </CardTitle>
          {contact.nameNative && contact.nameNative !== contact.name && (
            <div className="text-sm text-muted-foreground truncate">
              {contact.name}
            </div>
          )}
          {contact.position && (
            <div className="mt-1 text-sm text-muted-foreground truncate">
              {contact.position}
            </div>
          )}
          {contact.status !== "active" && (
            <div className="mt-2">
              <Badge
                variant="secondary"
                className={STATUS_COLOR[contact.status] ?? ""}
              >
                {STATUS_LABEL[contact.status] ?? contact.status}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-1 text-sm text-muted-foreground">
        {contact.email && (
          <div className="flex items-center gap-2 truncate">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{contact.email}</span>
          </div>
        )}
        {contact.phone && (
          <div className="flex items-center gap-2 truncate">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{contact.phone}</span>
          </div>
        )}
        {contact.position && (
          <div className="flex items-center gap-2 truncate">
            <Briefcase className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{contact.position}</span>
          </div>
        )}
        {contact.clientName && (
          <div className="flex items-center gap-2 truncate">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{contact.clientName}</span>
          </div>
        )}
        {/* Spacer pins the creator line to the bottom of the card so it stays
            aligned across cards of different content height. */}
        <div className="flex-1" aria-hidden />
        {contact.userName && (
          <div className="text-xs pt-1">Кто создал: {contact.userName}</div>
        )}
      </CardContent>
    </Card>
  )
}
