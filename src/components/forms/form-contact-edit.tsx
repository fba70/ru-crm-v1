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
import type { ContactRow, ClientOption } from "@/app/api/contacts/route"
import type { EntityStatus } from "@/db/schema"

// `initial` is reserved for contacts auto-created by the contact-discovery
// scan on /clients (Contacts tab). Operators flip it to `active` here
// once they confirm the row is a real CRM contact. Manual creation keeps
// defaulting to `active`.
// `deleted` is a soft-delete (hidden from lists by default, excluded from
// discovery dedup so a re-scan can re-create it). Flip back to `active` to
// restore.
const STATUSES: EntityStatus[] = ["active", "suspended", "initial", "deleted"]
const NO_CLIENT = "__none__"

type ContactFormData = {
  name: string
  nameNative: string
  phone: string
  email: string
  position: string
  clientId: string
  status: EntityStatus
}

type Props = {
  mode: "create" | "edit"
  contact?: ContactRow
  trigger: React.ReactNode
  onSuccess?: () => void
}

export default function ContactEditDialog({
  mode,
  contact,
  trigger,
  onSuccess,
}: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])

  const form = useForm<ContactFormData>({
    defaultValues: {
      name: contact?.name ?? "",
      nameNative: contact?.nameNative ?? "",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      position: contact?.position ?? "",
      clientId: contact?.clientId ?? NO_CLIENT,
      status: contact?.status ?? "active",
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      name: contact?.name ?? "",
      nameNative: contact?.nameNative ?? "",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      position: contact?.position ?? "",
      clientId: contact?.clientId ?? NO_CLIENT,
      status: contact?.status ?? "active",
    })
    let cancelled = false
    fetch("/api/contacts?clientOptions=1")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setClientOptions(data.options ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, contact, form])

  const onSubmit = (data: ContactFormData) => {
    startTransition(async () => {
      try {
        const clientId = data.clientId === NO_CLIENT ? null : data.clientId
        const payload =
          mode === "create"
            ? { ...data, clientId }
            : { id: contact!.id, ...data, clientId }
        const res = await fetch("/api/contacts", {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Failed to save contact")
          return
        }
        toast.success(mode === "create" ? "Contact created" : "Contact updated")
        onSuccess?.()
        setOpen(false)
      } catch {
        toast.error("Failed to save contact")
      }
    })
  }

  const title =
    mode === "create" ? "New contact" : `Edit contact: ${contact?.name ?? ""}`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="name"
                rules={{ required: "Name is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Contact name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nameNative"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">
                      Native name
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Local-language name (e.g. 张伟)"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
              name="position"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Position</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. CTO" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Client</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No client" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_CLIENT}>No client</SelectItem>
                        {clientOptions.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
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
