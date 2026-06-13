"use client"

import { useEffect, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { toast } from "sonner"
import { Pencil, Plus } from "lucide-react"
import { PROVIDER_LIST } from "@/lib/sources/providers"
import type { TemplateRow } from "@/server/templates"
import type { SourceProvider, SourceStatus, SourceType } from "@/db/schema"

const TYPES: { value: SourceType; label: string }[] = [
  { value: "external", label: "Внешний" },
  { value: "internal", label: "Внутренний" },
]

const STATUSES: { value: SourceStatus; label: string }[] = [
  { value: "active", label: "Активен" },
  { value: "inactive", label: "Неактивен" },
]

type FormValues = {
  name: string
  description: string
  type: SourceType
  provider: SourceProvider
  status: SourceStatus
  isDefault: boolean
  isVisibleToOrgs: boolean
  defaultAutomatedParsingIsAllowed: boolean
}

// Admin-only template editor. Used for both create (`<FormAdminEditTemplate />`)
// and edit (`<FormAdminEditTemplate template={t} />`).
//
// `defaultProviderConfig` is intentionally NOT editable from the UI in
// Phase 2 — it stays empty `{}` per the design (each org fills in its
// own config after instantiation). If a future template needs a non-
// empty default, an admin can update it via the API directly or we add
// the field here later.
export function FormAdminEditTemplate({
  template,
  onSuccess,
}: {
  template?: TemplateRow
  onSuccess?: () => void
}) {
  const isEdit = !!template
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const form = useForm<FormValues>({
    defaultValues: buildDefaults(template),
  })

  useEffect(() => {
    if (open) form.reset(buildDefaults(template))
  }, [open, template, form])

  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      const payload = {
        name: values.name,
        description: values.description || null,
        type: values.type,
        provider: values.provider,
        status: values.status,
        isDefault: values.isDefault,
        isVisibleToOrgs: values.isVisibleToOrgs,
        defaultAutomatedParsingIsAllowed: values.defaultAutomatedParsingIsAllowed,
      }
      const url = isEdit
        ? `/api/admin/templates/${template!.id}`
        : "/api/admin/templates"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(
          err.error ||
            (isEdit
              ? "Не удалось обновить шаблон"
              : "Не удалось создать шаблон"),
        )
        return
      }
      toast.success(isEdit ? "Шаблон обновлён" : "Шаблон создан")
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" aria-label="Редактировать шаблон">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Добавить
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800 max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Редактировать шаблон: ${template!.name}` : "Новый шаблон"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              rules={{ required: "Укажите название" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Название</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="напр. Google Drive" />
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
                      rows={2}
                      placeholder="Краткое описание, показываемое в выборе «Добавить источник» у владельца организации"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Тип</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="provider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">Провайдер</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROVIDER_LIST.map((p) => (
                          <SelectItem key={p.provider} value={p.provider}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Статус</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <FormItem className="flex flex-col gap-1">
                  <FormLabel className="text-gray-400">По умолчанию</FormLabel>
                  <div className="flex items-center gap-2 h-9">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      Автоматически создавать этот шаблон в каждой новой
                      организации. Этот флаг читает хук инициализации.
                    </span>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isVisibleToOrgs"
              render={({ field }) => (
                <FormItem className="flex flex-col gap-1">
                  <FormLabel className="text-gray-400">Видим организациям</FormLabel>
                  <div className="flex items-center gap-2 h-9">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      Показывать этот шаблон в выборе «Добавить источник» у
                      владельца организации.
                    </span>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultAutomatedParsingIsAllowed"
              render={({ field }) => (
                <FormItem className="flex flex-col gap-1">
                  <FormLabel className="text-gray-400">
                    Авторазбор по умолчанию
                  </FormLabel>
                  <div className="flex items-center gap-2 h-9">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      Начальное значение <code>automated_parsing_is_allowed</code>{" "}
                      для экземпляров, созданных из этого шаблона. Каждая
                      организация может изменить его независимо.
                    </span>
                  </div>
                </FormItem>
              )}
            />

            <DialogFooter>
              <LoadingButton
                type="submit"
                className="w-full"
                loading={isPending}
              >
                {isEdit ? "Сохранить" : "Создать"}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function buildDefaults(template?: TemplateRow): FormValues {
  return {
    name: template?.name ?? "",
    description: template?.description ?? "",
    type: template?.type ?? "external",
    provider: template?.provider ?? "nylas",
    status: template?.status ?? "active",
    isDefault: template?.isDefault ?? false,
    isVisibleToOrgs: template?.isVisibleToOrgs ?? true,
    defaultAutomatedParsingIsAllowed:
      template?.defaultAutomatedParsingIsAllowed ?? true,
  }
}
