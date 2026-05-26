"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Mail, Phone, Briefcase, Building2, Pencil } from "lucide-react"
import type { ContactRow } from "@/app/api/contacts/route"
import ContactEditDialog from "@/components/forms/form-contact-edit"

// `initial` is the auto-discovered state — orange accent for review
// attention. `suspended` stays muted (archived). `deleted` is the soft-
// delete (excluded from discovery) — red accent + dimmed card. Mirrors the
// same palette as the client card.
const STATUS_COLOR: Record<string, string> = {
  initial: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  suspended: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  deleted: "bg-red-500/15 text-red-600 dark:text-red-400",
}

export function ContactCard({
  contact,
  onChanged,
}: {
  contact: ContactRow
  onChanged: () => void
}) {
  return (
    <Card
      className={`flex flex-col dark:border-gray-600 ${
        contact.status === "deleted" ? "opacity-60" : ""
      }`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{contact.name}</CardTitle>
          {contact.nameNative && contact.nameNative !== contact.name && (
            <div className="text-sm text-muted-foreground truncate">
              {contact.nameNative}
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
                {contact.status}
              </Badge>
            </div>
          )}
        </div>
        <ContactEditDialog
          mode="edit"
          contact={contact}
          onSuccess={onChanged}
          trigger={
            <Button variant="ghost" size="icon" aria-label="Edit contact">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="flex-1 space-y-1 text-sm text-muted-foreground">
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
        {contact.userName && (
          <div className="text-xs pt-1">Created by {contact.userName}</div>
        )}
      </CardContent>
    </Card>
  )
}
