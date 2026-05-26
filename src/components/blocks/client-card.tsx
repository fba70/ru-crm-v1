"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowRight, Mail, Phone, MapPin, Globe, Pencil } from "lucide-react"
import type { ClientRow } from "@/app/api/clients/route"
import ClientEditDialog from "@/components/forms/form-client-edit"
import { ClientLookupDialog } from "@/components/blocks/client-lookup-dialog"

const PHASE_COLOR: Record<string, string> = {
  awareness: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  interest: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  decision: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  action: "bg-green-500/15 text-green-600 dark:text-green-300",
  retention: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
}

// `initial` is the auto-discovered state — give it a distinct accent so
// it stands out for review. `suspended` stays muted (archived). `deleted`
// is the soft-delete (excluded from discovery) — red accent + the card is
// dimmed below.
const STATUS_COLOR: Record<string, string> = {
  initial: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  suspended: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  deleted: "bg-red-500/15 text-red-600 dark:text-red-400",
}

export function ClientCard({
  client,
  onChanged,
}: {
  client: ClientRow
  onChanged: () => void
}) {
  const preview = client.contacts.slice(0, 2)
  const moreCount = Math.max(0, client.contacts.length - preview.length)

  return (
    <Card
      className={`flex flex-col dark:border-gray-600 ${
        client.status === "deleted" ? "opacity-60" : ""
      }`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{client.name}</CardTitle>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge
              className={PHASE_COLOR[client.funnelPhase] ?? ""}
              variant="secondary"
            >
              {client.funnelPhase}
            </Badge>
            {client.status !== "active" && (
              <Badge
                variant="secondary"
                className={STATUS_COLOR[client.status] ?? ""}
              >
                {client.status}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ClientLookupDialog
            client={client}
            onSaved={onChanged}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Lookup on web"
                title="Lookup on web"
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
              <Button variant="ghost" size="icon" aria-label="Edit client">
                <Pencil className="h-4 w-4" />
              </Button>
            }
          />
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 text-sm">
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
        </div>

        {client.contacts.length > 0 && (
          <div className="rounded-md border p-2 space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              Contacts ({client.contacts.length})
            </div>
            {preview.map((c) => (
              <div key={c.id} className="text-sm truncate">
                <span className="font-medium">{c.name}</span>
                {c.position && (
                  <span className="text-muted-foreground"> — {c.position}</span>
                )}
              </div>
            ))}
            {moreCount > 0 && (
              <div className="text-xs text-muted-foreground">
                +{moreCount} more (open to view)
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground truncate">
            {client.userName ? `Created by ${client.userName}` : ""}
          </span>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href={`/clients/${client.id}`}>
              Details
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
