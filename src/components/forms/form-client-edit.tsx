"use client"

import { useState, useTransition, useEffect } from "react"
import { useForm } from "react-hook-form"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/blocks/loading-button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import { toast } from "sonner"
import type { ClientRow, ClientContactPreview } from "@/app/api/clients/route"
import type { FunnelPhase, EntityStatus } from "@/db/schema"

const FUNNEL_PHASES: FunnelPhase[] = [
  "awareness",
  "interest",
  "decision",
  "action",
  "retention",
]

// `initial` is reserved for clients auto-created by the company-discovery
// scan (see /clients page). Operators flip it to `active` here once they
// confirm the row is a real CRM client. Manual creation keeps defaulting
// to `active`.
// `deleted` is a soft-delete: marking a client deleted hides it from the
// lists by default AND drops it from discovery dedup, so a re-scan can re-
// create it. Flip back to `active` here to restore.
const STATUSES: EntityStatus[] = ["active", "suspended", "initial", "deleted"]

type ClientFormData = {
  name: string
  /** Comma-separated in the form; split to string[] on submit. */
  aliases: string
  phone: string
  email: string
  address: string
  webUrl: string
  funnelPhase: FunnelPhase
  status: EntityStatus
}

type Props = {
  mode: "create" | "edit"
  client?: ClientRow
  trigger: React.ReactNode
  onSuccess?: () => void
}

function ContactList({ contacts }: { contacts: ClientContactPreview[] }) {
  if (!contacts.length) return null
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-sm font-medium text-muted-foreground">
        Related contacts ({contacts.length})
      </div>
      <ul className="space-y-1">
        {contacts.map((c) => (
          <li key={c.id} className="text-sm">
            <span className="font-medium">{c.name}</span>
            {c.position && (
              <span className="text-muted-foreground"> — {c.position}</span>
            )}
            {c.email && (
              <span className="text-muted-foreground"> · {c.email}</span>
            )}
            {c.phone && (
              <span className="text-muted-foreground"> · {c.phone}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function ClientEditDialog({
  mode,
  client,
  trigger,
  onSuccess,
}: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const form = useForm<ClientFormData>({
    defaultValues: {
      name: client?.name ?? "",
      aliases: (client?.aliases ?? []).join(", "),
      phone: client?.phone ?? "",
      email: client?.email ?? "",
      address: client?.address ?? "",
      webUrl: client?.webUrl ?? "",
      funnelPhase: client?.funnelPhase ?? "awareness",
      status: client?.status ?? "active",
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: client?.name ?? "",
        aliases: (client?.aliases ?? []).join(", "),
        phone: client?.phone ?? "",
        email: client?.email ?? "",
        address: client?.address ?? "",
        webUrl: client?.webUrl ?? "",
        funnelPhase: client?.funnelPhase ?? "awareness",
        status: client?.status ?? "active",
      })
    }
  }, [open, client, form])

  const onSubmit = (data: ClientFormData) => {
    startTransition(async () => {
      try {
        const aliases = (data.aliases ?? "")
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean)
        const payload =
          mode === "create"
            ? { ...data, aliases }
            : { id: client!.id, ...data, aliases }
        const res = await fetch("/api/clients", {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Failed to save client")
          return
        }
        toast.success(mode === "create" ? "Client created" : "Client updated")
        onSuccess?.()
        setOpen(false)
      } catch {
        toast.error("Failed to save client")
      }
    })
  }

  const title =
    mode === "create" ? "New client" : `Edit client: ${client?.name ?? ""}`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              rules={{ required: "Name is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Client name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Phone</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="+1 555 000 0000" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="hello@example.com"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Address</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Street, city, country" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="webUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Website</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="https://example.com" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="aliases"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Also known as</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Other spellings, comma-separated (e.g. AST, АСТ, AST INTER)"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="funnelPhase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">
                      Funnel phase
                    </FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FUNNEL_PHASES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Status</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {mode === "edit" && client && (
              <ContactList contacts={client.contacts} />
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <LoadingButton type="submit" loading={isPending}>
                {mode === "create" ? "Create" : "Save"}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
