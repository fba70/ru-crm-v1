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
import { Badge } from "@/components/ui/badge"
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
import { Pencil, Plus, KeyRound, Settings } from "lucide-react"
import type { AdminSource } from "@/app/api/admin/sources/route"
import type { SourceProvider, SourceStatus, SourceType } from "@/db/schema"
import { FormSourceCredentials } from "@/components/forms/form-source-credentials"
import { FormSourceProviderConfig } from "@/components/forms/form-source-provider-config"

const PROVIDERS: { value: SourceProvider; label: string }[] = [
  { value: "nylas", label: "Nylas (Email)" },
  { value: "gchat", label: "Google Chat" },
  { value: "gdrive", label: "Google Drive" },
  { value: "dropoff", label: "Files Drop Off" },
  { value: "whatsapp", label: "WhatsApp Archive" },
  { value: "telegram", label: "Telegram Bot" },
]

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
  isSystem: boolean
  ownerOrganizationId: string
  automatedParsingIsAllowed: boolean
}

type OrgOption = { id: string; name: string }

// Provider whose credentials schema is non-null. Drives the
// "Configure credentials" button visibility in edit mode.
const PROVIDERS_WITH_CREDENTIALS = new Set<SourceProvider>([
  "nylas",
  "gchat",
  "gdrive",
  "telegram",
])

export default function FormAdminEditSource({
  source,
  onSuccess,
}: {
  source?: AdminSource
  onSuccess?: () => void
}) {
  const isEdit = !!source
  const [open, setOpen] = useState(false)
  const [credsOpen, setCredsOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([])
  const [orgsLoading, setOrgsLoading] = useState(false)

  const form = useForm<FormValues>({
    defaultValues: buildDefaults(source),
  })

  // Reset whenever the dialog re-opens for a different row, so stale state
  // from a prior edit doesn't bleed into the next one.
  useEffect(() => {
    if (open) form.reset(buildDefaults(source))
  }, [open, source, form])

  // Org options are admin-scoped — fetch once per dialog-open.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setOrgsLoading(true)
    fetch("/api/admin/sources?orgOptions=1")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setOrgOptions(data.organizations ?? [])
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load organizations")
      })
      .finally(() => {
        if (!cancelled) setOrgsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const isSystem = form.watch("isSystem")
  const provider = form.watch("provider")

  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      if (!values.isSystem && !values.ownerOrganizationId) {
        toast.error("Pick an organization, or mark this source as system")
        return
      }

      // Provider config + credentials are NOT in this payload — they're
      // both managed by dedicated schema-driven dialogs that post to
      // /api/admin/sources/{config,credentials}. The /api/admin/sources
      // PUT route still accepts these fields for the migration script,
      // but the UI never sends them through here. New sources land
      // with empty providerConfig + null credentials_ref; the admin
      // saves first, then opens config + credentials dialogs in edit
      // mode to populate them.
      const payload = {
        ...(isEdit ? { sourceId: source!.id } : {}),
        name: values.name,
        description: values.description || null,
        type: values.type,
        provider: values.provider,
        status: values.status,
        isSystem: values.isSystem,
        ownerOrganizationId: values.isSystem
          ? null
          : values.ownerOrganizationId,
        automatedParsingIsAllowed: values.automatedParsingIsAllowed,
      }

      const res = await fetch("/api/admin/sources", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || `Failed to ${isEdit ? "update" : "create"} source`)
        return
      }
      toast.success(`Source ${isEdit ? "updated" : "created"}`)
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" aria-label="Edit source">
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
            {isEdit ? `Edit Source: ${source!.name}` : "New Source"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              rules={{ required: "Name is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Engineering Drive" />
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
                      placeholder="Short description shown to admins"
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
                        {PROVIDERS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
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
                name="isSystem"
                render={({ field }) => (
                  <FormItem className="flex flex-col gap-1">
                    <FormLabel className="text-gray-400">System source</FormLabel>
                    <div className="flex items-center gap-2 h-9">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(v) => field.onChange(v === true)}
                        />
                      </FormControl>
                      <span className="text-sm text-muted-foreground">
                        Available to every organization
                      </span>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="automatedParsingIsAllowed"
              render={({ field }) => (
                <FormItem className="flex flex-col gap-1">
                  <FormLabel className="text-gray-400">
                    Auto Parse
                  </FormLabel>
                  <div className="flex items-center gap-2 h-9">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      Daily cron may sync, parse, and upload items from this
                      source. Off = cron skips this source entirely; manual
                      actions still work.
                    </span>
                  </div>
                </FormItem>
              )}
            />

            {!isSystem && (
              <FormField
                control={form.control}
                name="ownerOrganizationId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">
                      Owner organization
                    </FormLabel>
                    <Select
                      value={field.value || ""}
                      onValueChange={field.onChange}
                      disabled={orgsLoading}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              orgsLoading
                                ? "Loading…"
                                : "Pick an organization"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {orgOptions.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            )}

            {/* Provider config + Credentials are managed by dedicated
                schema-driven dialogs — same components the org-owner
                table uses. Always rendered for providers that have a
                non-null providerConfigSchema / credentialsSchema; on
                create, both show "save first" hints since dialogs need
                an existing source row. */}
            {PROVIDERS_WITH_CREDENTIALS.has(provider) && (
              <FormItem>
                <FormLabel className="text-gray-400">Provider config</FormLabel>
                {isEdit && source ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfigOpen(true)}
                    >
                      <Settings className="h-3.5 w-3.5 mr-1" />
                      Edit config
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Non-secret connection routing (spaceId, driveId,
                      …). Schema-driven per provider — the dialog
                      pre-fills with the current values and validates on
                      save.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Save the source first — provider config is edited
                    afterward via the schema-driven dialog.
                  </p>
                )}
              </FormItem>
            )}

            {PROVIDERS_WITH_CREDENTIALS.has(provider) && (
              <FormItem>
                <FormLabel className="text-gray-400">Credentials</FormLabel>
                {isEdit && source ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={source.hasCredentials ? "default" : "outline"}
                        className="text-xs"
                      >
                        {source.hasCredentials ? "Configured" : "Not configured"}
                      </Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setCredsOpen(true)}
                      >
                        <KeyRound className="h-3.5 w-3.5 mr-1" />
                        {source.hasCredentials ? "Replace" : "Configure"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Credentials are write-only and validated against the
                      provider&apos;s schema. Existing values are never
                      displayed back; submitting replaces them.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Save the source first — credentials are configured
                    afterward via the per-provider schema-driven dialog
                    (Configure button appears in edit mode).
                  </p>
                )}
              </FormItem>
            )}

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
    {/* Sibling of the outer Dialog (NOT a child) — Radix Dialog children
        are expected to be DialogTrigger/DialogContent/etc. only.
        Keeping it as a sibling avoids stacked-portal bugs with focus
        and outside-click while the credentials sub-dialog is open. */}
    {isEdit && source && (
      <FormSourceCredentials
        open={credsOpen}
        onOpenChange={setCredsOpen}
        sourceId={source.id}
        sourceName={source.name}
        provider={source.provider}
        endpoint="/api/admin/sources/credentials"
        onSaved={() => {
          setCredsOpen(false)
          // Trigger the parent's reload so the badge flips to
          // "Configured" without keeping the outer dialog open on
          // stale data.
          onSuccess?.()
        }}
      />
    )}
    {isEdit && source && (
      <FormSourceProviderConfig
        open={configOpen}
        onOpenChange={setConfigOpen}
        sourceId={source.id}
        sourceName={source.name}
        provider={source.provider}
        initialConfig={source.providerConfig ?? {}}
        endpoint="/api/admin/sources/config"
        onSaved={() => {
          setConfigOpen(false)
          onSuccess?.()
        }}
      />
    )}
    </>
  )
}

function buildDefaults(source?: AdminSource): FormValues {
  return {
    name: source?.name ?? "",
    description: source?.description ?? "",
    type: source?.type ?? "external",
    provider: source?.provider ?? "nylas",
    status: source?.status ?? "active",
    isSystem: source?.isSystem ?? false,
    ownerOrganizationId: source?.ownerOrganizationId ?? "",
    automatedParsingIsAllowed: source?.automatedParsingIsAllowed ?? true,
  }
}
