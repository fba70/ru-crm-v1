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
      toast.error("Укажите название")
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
      if (!res.ok) throw new Error(data.error || "Не удалось обновить")
      toast.success("Сохранено")
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Неизвестная ошибка")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Название и описание источника</DialogTitle>
          <DialogDescription>
            Переименуйте источник или измените его описание. Тип провайдера и
            другие структурные поля доступны только администратору.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="source-identity-name">Название</Label>
            <Input
              id="source-identity-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-identity-description">Описание</Label>
            <Textarea
              id="source-identity-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Краткое описание для вашей команды"
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
            Отмена
          </Button>
          <Button type="button" onClick={handleSave} disabled={busy}>
            {busy ? "Сохранение…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
