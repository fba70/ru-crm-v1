"use client"

import { useState } from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Pencil } from "lucide-react"
import type { ContactRow } from "@/app/api/contacts/route"
import { ContactEditForm } from "@/components/forms/form-contact-edit"

export function DealInitiatorPopover({
  contactId,
  name,
}: {
  contactId: string
  name: string
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [contact, setContact] = useState<ContactRow | null>(null)
  const [loading, setLoading] = useState(false)

  async function loadContact() {
    setLoading(true)
    try {
      const res = await fetch(`/api/contacts?id=${encodeURIComponent(contactId)}`)
      const data = await res.json()
      setContact(data.contact ?? null)
    } catch {
      setContact(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setEditing(false)
          loadContact()
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-sm underline-offset-2 hover:underline cursor-pointer"
        >
          {name}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-h-[70vh] overflow-y-auto">
        {editing && contact ? (
          <ContactEditForm
            mode="edit"
            contact={contact}
            onSuccess={() => {
              setEditing(false)
              loadContact()
            }}
            onCancel={() => setEditing(false)}
          />
        ) : loading ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : contact ? (
          <div className="space-y-2 text-sm">
            <div className="font-medium">{contact.nameNative ?? contact.name}</div>
            {contact.position && (
              <div className="text-muted-foreground">{contact.position}</div>
            )}
            {contact.email && <div className="break-all">{contact.email}</div>}
            {contact.phone && <div>{contact.phone}</div>}
            <Button
              size="sm"
              variant="outline"
              className="mt-1"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Редактировать
            </Button>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Контакт не найден.</div>
        )}
      </PopoverContent>
    </Popover>
  )
}
