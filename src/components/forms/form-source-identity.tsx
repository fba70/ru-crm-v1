"use client"

// Owner-side identity dialog: edit a source's name + description.
// Other identity fields (type, provider, isSystem) stay admin-only via
// the Settings → Sources form. Posts to /api/sources/org/identity.

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  sourceId: string
  initialName: string
  initialDescription: string | null
  onSaved: () => void
}

export function FormSourceIdentity({
  open,
  onOpenChange,
  sourceId,
  initialName,
  initialDescription,
  onSaved,
}: Props) {
  // Same per-mount initialization rationale as <FormSourceProviderConfig>:
  // the parent unmounts the dialog between rows, so a fresh useState
  // initializer per mount keeps these in sync without an effect.
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? "")
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/sources/org/identity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId,
          name: name.trim(),
          description: description.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Update failed")
      toast.success("Identity saved")
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit source identity</DialogTitle>
          <DialogDescription>
            Rename this source or update its description. Provider type
            and other structural fields remain admin-only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="source-identity-name">Name</Label>
            <Input
              id="source-identity-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-identity-description">Description</Label>
            <Textarea
              id="source-identity-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Short description for your team"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
