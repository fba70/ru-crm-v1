"use client"

import { useState, useTransition, useEffect, useMemo } from "react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
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
import type {
  DealRow,
  DealClientOption,
  DealContactOption,
  DealFunnelStageOption,
} from "@/app/api/deals/route"
import type { DealStatus } from "@/db/schema"

// Edit-form status options. `active` is the live state; `cancelled` =
// lost/withdrawn (kept for analytics); `deleted` = test/mistake, hidden
// from the board AND excluded from deal discovery.
const DEAL_STATUS_OPTIONS: { value: DealStatus; label: string }[] = [
  { value: "active", label: "Активна" },
  { value: "cancelled", label: "Отменена (проиграна / отозвана)" },
  { value: "deleted", label: "Удалена (скрыта, исключена из поиска)" },
]

type DealFormData = {
  name: string
  description: string
  funnelStageId: string
  clientId: string
  value: string
  currency: string
  status: DealStatus
  // Multi-select kept inside the form state so the dialog's open-effect
  // can reset everything via a single `form.reset(...)` call — separate
  // useState here triggers a cascading-render lint error.
  contactIds: string[]
}

type Props = {
  mode: "create" | "edit"
  deal?: DealRow
  trigger: React.ReactNode
  onSuccess?: () => void
}

export default function DealEditDialog({
  mode,
  deal,
  trigger,
  onSuccess,
}: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [clientOptions, setClientOptions] = useState<DealClientOption[]>([])
  const [contactOptions, setContactOptions] = useState<DealContactOption[]>([])
  const [stageOptions, setStageOptions] = useState<DealFunnelStageOption[]>([])

  const form = useForm<DealFormData>({
    defaultValues: {
      name: deal?.name ?? "",
      description: deal?.description ?? "",
      funnelStageId: deal?.funnelStageId ?? "",
      clientId: deal?.clientId ?? "",
      value: deal?.value ?? "",
      currency: deal?.currency ?? "EUR",
      status: deal?.status ?? "active",
      contactIds: deal?.contacts.map((c) => c.id) ?? [],
    },
  })

  const watchedContactIds = form.watch("contactIds")
  const watchedClientId = form.watch("clientId")
  const selectedContactIds = useMemo(
    () => new Set(watchedContactIds),
    [watchedContactIds],
  )

  // Open effect: fetch clients + funnel stages, THEN reset the form with
  // the default stage already baked in. Doing one final `form.reset` (vs.
  // an early reset + a later `setValue`) keeps the funnel-stage value and
  // its matching SelectItem in the same render commit — Radix Select
  // doesn't reliably pick up a value change when the item set lags by one
  // commit. Contacts are NOT fetched here — they're scoped to the chosen
  // client and loaded by the separate effect below as `clientId` changes.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const [cRes, sRes] = await Promise.all([
          fetch("/api/deals?clientOptions=1").then((r) => r.json()),
          fetch("/api/deals?funnelStages=1").then((r) => r.json()),
        ])
        if (cancelled) return
        const stages: DealFunnelStageOption[] = sRes.stages ?? []
        setClientOptions(cRes.options ?? [])
        setStageOptions(stages)

        // Default for create mode: lowest sortOrder stage (Qualification
        // in the seeded funnel). Edit mode: keep whatever the deal has.
        const defaultFunnelStageId =
          mode === "create"
            ? (stages[0]?.id ?? "")
            : (deal?.funnelStageId ?? "")

        form.reset({
          name: deal?.name ?? "",
          description: deal?.description ?? "",
          funnelStageId: defaultFunnelStageId,
          clientId: deal?.clientId ?? "",
          value: deal?.value ?? "",
          currency: deal?.currency ?? "EUR",
          status: deal?.status ?? "active",
          contactIds: deal?.contacts.map((c) => c.id) ?? [],
        })
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [open, deal, form, mode])

  // Contacts are scoped to the selected client. When no client is picked,
  // the list is empty and any previously-selected contact ids are cleared.
  // When the client changes, drop any contact ids that don't belong to the
  // new client (defensive — covers the rare case of editing a deal whose
  // legacy contacts were attached cross-client).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      if (!watchedClientId) {
        if (cancelled) return
        setContactOptions([])
        if (form.getValues("contactIds").length > 0) {
          form.setValue("contactIds", [])
        }
        return
      }
      try {
        const res = await fetch(
          `/api/deals?contactOptions=1&clientId=${encodeURIComponent(watchedClientId)}`,
        ).then((r) => r.json())
        if (cancelled) return
        const options: DealContactOption[] = res.options ?? []
        setContactOptions(options)
        const valid = new Set(options.map((o) => o.id))
        const current = form.getValues("contactIds")
        const filtered = current.filter((id) => valid.has(id))
        if (filtered.length !== current.length) {
          form.setValue("contactIds", filtered)
        }
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [open, watchedClientId, form])

  const toggleContact = (id: string) => {
    const current = form.getValues("contactIds")
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id]
    form.setValue("contactIds", next, { shouldDirty: true })
  }

  const orderedContactOptions = useMemo(() => {
    // Selected contacts at the top so the picked set is always visible
    // even when the list is long.
    const selected: DealContactOption[] = []
    const rest: DealContactOption[] = []
    for (const c of contactOptions) {
      if (selectedContactIds.has(c.id)) selected.push(c)
      else rest.push(c)
    }
    return [...selected, ...rest]
  }, [contactOptions, selectedContactIds])

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of clientOptions) map.set(c.id, c.name)
    return map
  }, [clientOptions])

  const onSubmit = (data: DealFormData) => {
    startTransition(async () => {
      try {
        const trimmedValue = data.value.trim()
        const numericValue = trimmedValue === "" ? null : Number(trimmedValue)
        if (numericValue !== null && !Number.isFinite(numericValue)) {
          toast.error("Стоимость должна быть числом")
          return
        }
        const payload =
          mode === "create"
            ? {
                name: data.name,
                description: data.description,
                funnelStageId: data.funnelStageId,
                clientId: data.clientId,
                contactIds: data.contactIds,
                value: numericValue,
                currency: data.currency,
              }
            : {
                id: deal!.id,
                name: data.name,
                description: data.description,
                funnelStageId: data.funnelStageId,
                clientId: data.clientId,
                contactIds: data.contactIds,
                value: numericValue,
                currency: data.currency,
                status: data.status,
              }
        const res = await fetch("/api/deals", {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось сохранить сделку")
          return
        }
        toast.success(mode === "create" ? "Сделка создана" : "Сделка обновлена")
        onSuccess?.()
        setOpen(false)
      } catch {
        toast.error("Не удалось сохранить сделку")
      }
    })
  }

  const title =
    mode === "create"
      ? "Новая сделка"
      : `Редактирование сделки: ${deal?.name ?? ""}`

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
                    <Input {...field} placeholder="Название сделки" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Описание</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Необязательные детали…"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="clientId"
                rules={{ required: "Укажите клиента" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Клиент *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите клиента" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
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
                name="funnelStageId"
                rules={{ required: "Укажите этап воронки" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">
                      Этап воронки *
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите этап" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {stageOptions.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}{" "}
                            <span className="text-muted-foreground">
                              ({Math.round(s.closureProbability * 100)}%)
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="value"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel className="text-gray-400">Стоимость</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        {...field}
                        placeholder="0.00"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                rules={{
                  required: "Укажите валюту",
                  pattern: {
                    value: /^[A-Za-z]{3}$/,
                    message: "3-буквенный код ISO",
                  },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Валюта</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="EUR"
                        maxLength={3}
                        className="uppercase"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">Контакты</Label>
              {!watchedClientId ? (
                <div className="text-xs text-muted-foreground">
                  Выберите клиента, чтобы выбрать контакты.
                </div>
              ) : orderedContactOptions.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  К этому клиенту ещё не привязаны контакты.
                </div>
              ) : (
                <div className="max-h-44 overflow-y-auto rounded-md border border-input bg-background dark:bg-muted/30 p-2 space-y-1">
                  {orderedContactOptions.map((c) => {
                    const checked = selectedContactIds.has(c.id)
                    const linkedClient = c.clientId
                      ? clientNameById.get(c.clientId)
                      : null
                    return (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleContact(c.id)}
                        />
                        <span className="flex-1 truncate">{c.name}</span>
                        {linkedClient && (
                          <span className="text-xs text-muted-foreground truncate">
                            {linkedClient}
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Выбрано: {selectedContactIds.size}
              </div>
            </div>

            {mode === "edit" && (
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
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DEAL_STATUS_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
