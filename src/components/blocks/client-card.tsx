"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ArrowRight,
  Mail,
  Phone,
  MapPin,
  Globe,
  Pencil,
  MessageSquare,
} from "lucide-react"
import type { ClientRow } from "@/app/api/clients/route"
import ClientEditDialog from "@/components/forms/form-client-edit"
import { ClientLookupDialog } from "@/components/blocks/client-lookup-dialog"
import { BlacklistEntityButton } from "@/components/blocks/client-blocklist-dialog"

// `initial` is the auto-discovered state — give it a distinct accent so
// it stands out for review. `suspended` stays muted (archived). `deleted`
// is the soft-delete (excluded from discovery) — red accent + the card is
// dimmed below.
const STATUS_COLOR: Record<string, string> = {
  initial: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  suspended: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  deleted: "bg-red-500/15 text-red-600 dark:text-red-400",
  blocked: "bg-rose-600/15 text-rose-700 dark:text-rose-300",
}

// UI display labels for the status badge (DB enum values stay English).
const STATUS_LABEL: Record<string, string> = {
  active: "Активный",
  initial: "Новый",
  suspended: "Приостановлен",
  deleted: "Удалён",
  blocked: "Заблокирован",
}

export function ClientCard({
  client,
  onChanged,
  canBlock = false,
}: {
  client: ClientRow
  onChanged: () => void
  // When true (owner), show the "add to blocklist" action.
  canBlock?: boolean
}) {
  const preview = client.contacts.slice(0, 2)
  const moreCount = Math.max(0, client.contacts.length - preview.length)

  return (
    <Card
      className={`flex flex-col dark:border-gray-600 ${
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
              non-active status badge is shown. */}
          {client.status !== "active" && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge
                variant="secondary"
                className={STATUS_COLOR[client.status] ?? ""}
              >
                {STATUS_LABEL[client.status] ?? client.status}
              </Badge>
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
              <Button variant="ghost" size="icon" aria-label="Редактировать клиента">
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
        <div className="space-y-1 text-muted-foreground">
          {client.email && (
            <div className="flex items-center gap-2 truncate">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{client.email}</span>
            </div>
          )}
          {client.phone && (
            <div className="flex items-center gap-2 truncate">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{client.phone}</span>
            </div>
          )}
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
                className="truncate hover:underline text-blue-600 dark:text-blue-400"
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
