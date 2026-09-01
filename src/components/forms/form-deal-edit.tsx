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
import { Checkbox } from "@/components/ui/checkbox"
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
  DealClientOption,
  DealFunnelStageOption,
} from "@/app/api/deals/route"
import { dealStageLabel } from "@/lib/deal-funnel"
import { CURRENCY_SYMBOL } from "@/lib/deal-board"
import TaskEditDialog from "@/components/forms/form-task-edit"

// Create-only — редактирование существующей сделки теперь идёт через
// <DealDetailDrawer> (inline-форма прямо в панели подробностей), не через
// эту модалку. Было mode="create"|"edit"; edit-ветки убраны как мёртвый код
// после того, как оба вызывающих места (карточка, дровер) переключились на
// дровер.
type DealFormData = {
  name: string
  description: string
  funnelStageId: string
  clientId: string
  value: string
}

type Props = {
  trigger: React.ReactNode
  onSuccess?: () => void
}

export default function DealEditDialog({ trigger, onSuccess }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [clientOptions, setClientOptions] = useState<DealClientOption[]>([])
  const [stageOptions, setStageOptions] = useState<DealFunnelStageOption[]>([])
  // Опциональная первая задача при СОЗДАНИИ сделки (UX): вместо урезанной
  // копии формы задачи (только имя/срок/исполнитель — не было типа,
  // приоритета, описания, приходилось потом редактировать в Задачах) сразу
  // после создания сделки открываем НАСТОЯЩИЙ TaskEditDialog (тот же, что в
  // разделе «Задачи»), предзаполненный dealId+clientId.
  const [addTask, setAddTask] = useState(false)
  const [taskName, setTaskName] = useState("")
  const [pendingTaskDeal, setPendingTaskDeal] = useState<{
    dealId: string
    clientId: string
    name?: string
  } | null>(null)

  const form = useForm<DealFormData>({
    defaultValues: {
      name: "",
      description: "",
      funnelStageId: "",
      clientId: "",
      value: "",
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

        // Default: lowest sortOrder stage (Qualification in the seeded
        // funnel).
        form.reset({
          name: "",
          description: "",
          funnelStageId: stages[0]?.id ?? "",
          clientId: "",
          value: "",
        })
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [open, form])

  const onSubmit = (data: DealFormData) => {
    startTransition(async () => {
      try {
        const trimmedValue = data.value.trim()
        const numericValue = trimmedValue === "" ? null : Number(trimmedValue)
        if (numericValue !== null && !Number.isFinite(numericValue)) {
          toast.error("Сумма должна быть числом")
          return
        }
        const res = await fetch("/api/deals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.name,
            description: data.description,
            funnelStageId: data.funnelStageId,
            clientId: data.clientId,
            value: numericValue,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось сохранить сделку")
          return
        }
        toast.success("Сделка создана")
        onSuccess?.()
        setOpen(false)
        // Опциональная первая задача: вместо своей копии формы — открываем
        // настоящий TaskEditDialog поверх (тот же, что в «Задачах»),
        // предзаполненный сделкой+клиентом. Название сюда переносим как
        // стартовое значение, остальное (тип/приоритет/срок/исполнитель/
        // описание) заполняется в самой форме, без похода в Задачи потом.
        if (addTask) {
          const { id: newDealId } = (await res.json().catch(() => ({}))) as {
            id?: string
          }
          if (newDealId) {
            setPendingTaskDeal({
              dealId: newDealId,
              clientId: data.clientId,
              name: taskName.trim() || undefined,
            })
          }
        }
        setAddTask(false)
        setTaskName("")
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

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Новая сделка</DialogTitle>
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

            {/* Первая задача — чекбокс раскрывает поле названия (стартовое
                значение); саму задачу заполняют в настоящей форме задачи,
                которая откроется сразу после создания сделки (см.
                pendingTaskDeal ниже). */}
            <div className="rounded-lg border p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={addTask}
                  onCheckedChange={(v) => setAddTask(Boolean(v))}
                />
                Создать задачу для этой сделки
              </label>
              {addTask && (
                <Input
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="Название задачи (напр. «Позвонить клиенту»)"
                />
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Отмена
              </Button>
              <LoadingButton type="submit" loading={isPending}>
                Создать
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
    {/* Настоящая форма задачи (та же, что в «Задачах»), а не урезанный
        дубль полей — открывается сама сразу после создания сделки. */}
    {pendingTaskDeal && (
      <TaskEditDialog
        mode="create"
        open
        onOpenChange={(o) => {
          if (!o) setPendingTaskDeal(null)
        }}
        initialValues={{
          name: pendingTaskDeal.name,
          dealId: pendingTaskDeal.dealId,
          clientId: pendingTaskDeal.clientId,
        }}
        onSuccess={onSuccess}
        trigger={<span className="hidden" aria-hidden />}
      />
    )}
    </>
  )
}
