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
import { Textarea } from "@/components/ui/textarea"
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
import { authClient } from "@/lib/auth-client"
import type { ClientRow, ClientContactPreview } from "@/app/api/clients/route"
import type { FunnelPhase, EntityStatus } from "@/db/schema"
import {
  CLIENT_TYPE_LABELS,
  CLIENT_TYPE_VALUES,
  orgHasStructuredClientType,
  type ClientType,
} from "@/lib/client-custom-fields"

// Sentinel for the "no type selected" option — shadcn SelectItem can't carry
// an empty-string value.
const TYPE_NONE = "__none__"

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
// `blocked` is the blocklist suppression — flip back to `active` here to
// reactivate (it stays blocklisted in the dictionary, so re-blocking on the
// next discovery run is possible until the entry is removed).
const STATUSES: EntityStatus[] = [
  "active",
  "suspended",
  "initial",
  "deleted",
  "blocked",
]

// UI display labels (DB enum values stay English).
const PHASE_LABEL: Record<string, string> = {
  awareness: "Осведомлённость",
  interest: "Интерес",
  decision: "Решение",
  action: "Действие",
  retention: "Удержание",
}
const STATUS_LABEL: Record<string, string> = {
  active: "Активный",
  suspended: "Приостановлен",
  initial: "Новый",
  deleted: "Удалён",
  blocked: "Заблокирован",
}

type ClientFormData = {
  name: string
  namePhys: string
  comment: string
  /** Comma-separated in the form; split to string[] on submit. */
  aliases: string
  phone: string
  email: string
  address: string
  webUrl: string
  /** Stored under `customFields.type`; `TYPE_NONE` means unset. */
  type: ClientType | typeof TYPE_NONE
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
        Связанные контакты ({contacts.length})
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
  const { data: session } = authClient.useSession()

  // Active org: the client's own org in edit mode, otherwise the session's
  // active org for create mode. Drives whether the `type` field is shown.
  const orgId = client?.organizationId ?? session?.session.activeOrganizationId
  const showTypeField = orgHasStructuredClientType(orgId)

  const form = useForm<ClientFormData>({
    defaultValues: {
      name: client?.name ?? "",
      namePhys: client?.namePhys ?? "",
      comment: client?.comment ?? "",
      aliases: (client?.aliases ?? []).join(", "),
      phone: client?.phone ?? "",
      email: client?.email ?? "",
      address: client?.address ?? "",
      webUrl: client?.webUrl ?? "",
      type: client?.customFields?.type ?? TYPE_NONE,
      funnelPhase: client?.funnelPhase ?? "awareness",
      status: client?.status ?? "active",
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: client?.name ?? "",
        namePhys: client?.namePhys ?? "",
        comment: client?.comment ?? "",
        aliases: (client?.aliases ?? []).join(", "),
        phone: client?.phone ?? "",
        email: client?.email ?? "",
        address: client?.address ?? "",
        webUrl: client?.webUrl ?? "",
        type: client?.customFields?.type ?? TYPE_NONE,
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
        // Fold the flat `type` select back into the extensible custom-fields
        // bag, preserving any other keys already on the client. The server
        // re-validates + forces `{}` for orgs without the structured type.
        const { type, ...rest } = data
        const customFields = {
          ...(client?.customFields ?? {}),
          type: type === TYPE_NONE ? undefined : type,
        }
        const payload =
          mode === "create"
            ? { ...rest, aliases, customFields }
            : { id: client!.id, ...rest, aliases, customFields }
        const res = await fetch("/api/clients", {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось сохранить клиента")
          return
        }
        toast.success(mode === "create" ? "Клиент создан" : "Клиент обновлён")
        onSuccess?.()
        setOpen(false)
      } catch {
        toast.error("Не удалось сохранить клиента")
      }
    })
  }

  const title =
    mode === "create"
      ? "Новый клиент"
      : `Редактирование клиента: ${client?.name ?? ""}`

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
              rules={{ required: "Укажите название" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Название *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Название клиента" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="namePhys"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">
                    ФИО физлица
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="ФИО физического лица (если это не организация)"
                    />
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
                    <FormLabel className="text-gray-400">Телефон</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="+7 999 000 0000" />
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
                  <FormLabel className="text-gray-400">Адрес</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Улица, город, страна" />
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
                  <FormLabel className="text-gray-400">Сайт</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="https://example.com" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showTypeField && (
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Тип</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите тип" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={TYPE_NONE}>—</SelectItem>
                        {CLIENT_TYPE_VALUES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {CLIENT_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="comment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Комментарий</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Заметки, помогающие опознать клиента"
                    />
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
                  <FormLabel className="text-gray-400">Другие названия</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Другие написания через запятую (напр. AST, АСТ, AST INTER)"
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
                      Этап воронки
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
                            {PHASE_LABEL[p] ?? p}
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
                    <FormLabel className="text-gray-400">Статус</FormLabel>
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
                            {STATUS_LABEL[s] ?? s}
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
                Отмена
              </Button>
              <LoadingButton type="submit" loading={isPending}>
                {mode === "create" ? "Создать" : "Сохранить"}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
