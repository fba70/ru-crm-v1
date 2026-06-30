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
  DealFunnelStageOption,
} from "@/app/api/deals/route"
import type { DealStatus } from "@/db/schema"
import { dealStageLabel } from "@/lib/deal-funnel"
import { CURRENCY_SYMBOL } from "@/lib/deal-board"
import { DealInitiatorPopover } from "@/components/blocks/deal-initiator-popover"

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
  status: DealStatus
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
  const [stageOptions, setStageOptions] = useState<DealFunnelStageOption[]>([])

  const form = useForm<DealFormData>({
    defaultValues: {
      name: deal?.name ?? "",
      description: deal?.description ?? "",
      funnelStageId: deal?.funnelStageId ?? "",
      clientId: deal?.clientId ?? "",
      value: deal?.value ?? "",
      status: deal?.status ?? "active",
    },
  })

  // Open effect: fetch clients + funnel stages, THEN reset the form with
  // the default stage already baked in. Doing one final `form.reset` (vs.
  // an early reset + a later `setValue`) keeps the funnel-stage value and
  // its matching SelectItem in the same render commit — Radix Select
  // doesn't reliably pick up a value change when the item set lags by one
  // commit.
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
          status: deal?.status ?? "active",
        })
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [open, deal, form, mode])

  const onSubmit = (data: DealFormData) => {
    startTransition(async () => {
      try {
        const trimmedValue = data.value.trim()
        const numericValue = trimmedValue === "" ? null : Number(trimmedValue)
        if (numericValue !== null && !Number.isFinite(numericValue)) {
          toast.error("Сумма должна быть числом")
          return
        }
        const payload =
          mode === "create"
            ? {
                name: data.name,
                description: data.description,
                funnelStageId: data.funnelStageId,
                clientId: data.clientId,
                value: numericValue,
              }
            : {
                id: deal!.id,
                name: data.name,
                description: data.description,
                funnelStageId: data.funnelStageId,
                clientId: data.clientId,
                value: numericValue,
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

  const watchedClientId = form.watch("clientId")
  const selectedClient = clientOptions.find((c) => c.id === watchedClientId)
  const currencySymbol =
    CURRENCY_SYMBOL[(selectedClient?.currency ?? "RUB").toUpperCase()] ??
    (selectedClient?.currency ?? "RUB")

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

            {mode === "edit" && !!deal?.contacts?.length && (
              <div className="space-y-2">
                <Label className="text-gray-400">Инициатор</Label>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {deal.contacts.map((c) => (
                    <DealInitiatorPopover key={c.id} contactId={c.id} name={c.name} />
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="clientId"
                rules={{ required: "Укажите клиента" }}
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel className="text-gray-400">Клиент *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
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
                  <FormItem className="min-w-0">
                    <FormLabel className="text-gray-400">
                      Этап воронки *
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите этап" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {stageOptions.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {dealStageLabel(s.name)}{" "}
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

            <FormField
              control={form.control}
              name="value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Сумма</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {currencySymbol}
                      </span>
                      <Input
                        className="pl-7"
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        placeholder="0"
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
