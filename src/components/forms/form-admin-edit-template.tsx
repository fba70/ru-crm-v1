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
  { value: "external", label: "external" },
  { value: "internal", label: "internal" },
]

const STATUSES: { value: SourceStatus; label: string }[] = [
  { value: "active", label: "active" },
  { value: "inactive", label: "inactive" },
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
        toast.error(err.error || `Failed to ${isEdit ? "update" : "create"} template`)
        return
      }
      toast.success(`Template ${isEdit ? "updated" : "created"}`)
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" aria-label="Edit template">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Add new
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800 max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit Template: ${template!.name}` : "New Template"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              rules={{ required: "Name is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Google Drive" />
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
                  <FormLabel className="text-gray-400">Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={2}
                      placeholder="Short description shown in the org-owner Add Source picker"
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
                    <FormLabel className="text-gray-400">Type</FormLabel>
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
                    <FormLabel className="text-gray-400">Provider</FormLabel>
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
                  <FormLabel className="text-gray-400">Status</FormLabel>
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
                  <FormLabel className="text-gray-400">Default</FormLabel>
                  <div className="flex items-center gap-2 h-9">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      Auto-instantiate this template into every newly-
                      created organisation. The bootstrap hook reads this
                      flag.
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
                  <FormLabel className="text-gray-400">Visible to orgs</FormLabel>
                  <div className="flex items-center gap-2 h-9">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      Show this template in the org-owner &quot;Add source&quot;
                      picker.
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
                    Default Auto Parse
                  </FormLabel>
                  <div className="flex items-center gap-2 h-9">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      Initial value of <code>automated_parsing_is_allowed</code>{" "}
                      on instances created from this template. Each org
                      can flip this independently afterwards.
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
                {isEdit ? "Save" : "Create"}
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
