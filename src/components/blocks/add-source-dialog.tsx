"use client"

// Org-owner "Add source" picker. Lists templates that are
// `status='active'` AND `is_visible_to_orgs=true` and lets the owner
// instantiate one into their active org. The new row lands with empty
// providerConfig + null credentialsRef; the owner finishes setup via
// the existing Edit-config + Configure-credentials buttons on the
// "Manage organization sources" tab.

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader, Plus } from "lucide-react"
import { toast } from "sonner"
import { getProvider } from "@/lib/sources/providers"
import type { TemplateRow } from "@/server/templates"

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  onCreated: () => void
  // Template ids of sources the active org already has. Used purely for
  // the per-row "you already have N of these" hint — adding the same
  // template a second time is intentional and supported (creates a
  // parallel instance with its own credentials), the count just sets
  // expectations so the owner doesn't think they're rebooting setup.
  existingTemplateIds?: string[]
}

export function AddSourceDialog({
  open,
  onOpenChange,
  onCreated,
  existingTemplateIds = [],
}: Props) {
  // Tally how many existing sources point at each template. Computed
  // here rather than in the parent so consumers don't have to.
  const existingCountByTemplateId = existingTemplateIds.reduce<
    Record<string, number>
  >((acc, id) => {
    acc[id] = (acc[id] ?? 0) + 1
    return acc
  }, {})
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch("/api/sources/org/instantiate")
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to load templates")
        if (!cancelled) setTemplates(data.templates ?? [])
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleAdd(template: TemplateRow) {
    setSubmitting(template.id)
    try {
      const res = await fetch("/api/sources/org/instantiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to add source")
      toast.success(
        `${template.name} added — open Edit config + Configure credentials to finish setup`,
      )
      onCreated()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add source</DialogTitle>
          <DialogDescription>
            Pick a template to add to your organisation. The source will
            be created with template defaults; finish setup by clicking
            <strong> Edit config </strong> and <strong> Configure </strong>
            on the new row.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader className="h-4 w-4 animate-spin mr-2" />
            Loading templates…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-4">{error}</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No templates available. Ask a platform admin to create one
            in Settings → Templates.
          </p>
        ) : (
          <ul className="space-y-2 py-2">
            {templates.map((t) => {
              const meta = getProvider(t.provider)
              const Icon = meta.icon
              const inFlight = submitting === t.id
              const existingCount = existingCountByTemplateId[t.id] ?? 0
              return (
                <li
                  key={t.id}
                  className="flex items-start gap-3 rounded-md border p-3"
                >
                  <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{t.name}</div>
                    {t.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {t.description}
                      </p>
                    )}
                    {existingCount > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        You already have {existingCount} source
                        {existingCount === 1 ? "" : "s"} of this type.
                        Adding another creates a parallel instance with
                        its own credentials.
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleAdd(t)}
                    disabled={submitting !== null}
                  >
                    {inFlight ? (
                      <>
                        <Loader className="h-3.5 w-3.5 mr-1 animate-spin" />
                        Adding…
                      </>
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add
                      </>
                    )}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
