"use client"

import { useState, useTransition } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/blocks/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import type {
  UserOrgInfo,
  OrgOption,
} from "@/app/api/admin/user-organizations/route"

type OrgRole = "owner" | "admin" | "member"
type Row = { organizationId: string; organizationName: string; role: OrgRole }

// Admin-only dialog to edit a user's full organization membership set: add new
// orgs, remove existing ones, change per-org roles, then save the whole config
// in one reconcile call. Goes through `/api/admin/user-organizations` (server,
// requireAdmin + direct DB) — never the better-auth org plugin.
export default function AdminEditUserOrgsDialog({
  userId,
  userName,
  orgDetails,
  onSuccess,
}: {
  userId: string
  userName: string
  orgDetails: UserOrgInfo[]
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [rows, setRows] = useState<Row[]>([])
  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([])
  const [addOrgId, setAddOrgId] = useState("")

  // Reset the editable set + load all orgs whenever the dialog opens (done in
  // the open handler, not an effect, to avoid a cascading setState-in-effect).
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setRows(
      orgDetails.map((o) => ({
        organizationId: o.organizationId,
        organizationName: o.organizationName,
        role: (o.orgRole as OrgRole) ?? "member",
      })),
    )
    setAddOrgId("")
    fetch("/api/admin/user-organizations?orgOptions=1")
      .then((r) => r.json())
      .then((d) => setOrgOptions(d.organizations ?? []))
      .catch(() => {})
  }

  const usedIds = new Set(rows.map((r) => r.organizationId))
  const availableOrgs = orgOptions.filter((o) => !usedIds.has(o.id))

  const setRowRole = (organizationId: string, role: OrgRole) => {
    setRows((prev) =>
      prev.map((r) => (r.organizationId === organizationId ? { ...r, role } : r)),
    )
  }

  const removeRow = (organizationId: string) => {
    setRows((prev) => prev.filter((r) => r.organizationId !== organizationId))
  }

  const addRow = () => {
    if (!addOrgId) return
    const opt = orgOptions.find((o) => o.id === addOrgId)
    if (!opt) return
    setRows((prev) => [
      ...prev,
      { organizationId: opt.id, organizationName: opt.name, role: "member" },
    ])
    setAddOrgId("")
  }

  const handleSave = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/user-organizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "setMemberships",
            userId,
            memberships: rows.map((r) => ({
              organizationId: r.organizationId,
              role: r.role,
            })),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || "Не удалось сохранить участие в организациях")
          return
        }
        toast.success(`Организации обновлены для ${userName}`)
        onSuccess?.()
        setOpen(false)
      } catch {
        toast.error("Не удалось сохранить участие в организациях")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Организации
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Организации для {userName}</DialogTitle>
          <DialogDescription>
            Добавляйте или удаляйте организации и задавайте роль в каждой.
            Изменения применяются при сохранении.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока не состоит ни в одной организации.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div
                  key={r.organizationId}
                  className="flex items-center gap-2"
                >
                  <span className="flex-1 truncate text-sm" title={r.organizationName}>
                    {r.organizationName}
                  </span>
                  <Select
                    value={r.role}
                    onValueChange={(v) => setRowRole(r.organizationId, v as OrgRole)}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">Владелец</SelectItem>
                      <SelectItem value="admin">Администратор</SelectItem>
                      <SelectItem value="member">Участник</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Удалить ${r.organizationName}`}
                    onClick={() => removeRow(r.organizationId)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add an organization the user isn't in yet. */}
          <div className="flex items-center gap-2 border-t pt-3">
            <Select value={addOrgId} onValueChange={setAddOrgId}>
              <SelectTrigger className="flex-1">
                <SelectValue
                  placeholder={
                    availableOrgs.length
                      ? "Добавить организацию…"
                      : "Больше нет организаций"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableOrgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={addRow}
              disabled={!addOrgId}
            >
              Добавить
            </Button>
          </div>

          <DialogFooter>
            <LoadingButton
              onClick={handleSave}
              className="w-full"
              loading={isPending}
            >
              Сохранить организации
            </LoadingButton>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
