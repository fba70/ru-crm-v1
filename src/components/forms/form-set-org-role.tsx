"use client"

import { useState, useTransition } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { authClient } from "@/lib/auth-client"
import { toast } from "sonner"

// Display labels — DB enum keys stay English.
const ORG_ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
}

export default function SetOrgRoleDialog({
  memberId,
  memberName,
  currentRole,
  organizationId,
  onSuccess,
}: {
  memberId: string
  memberName: string
  currentRole: string
  organizationId: string
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<"owner" | "admin" | "member">(
    (currentRole as "owner" | "admin" | "member") || "member",
  )
  const [isPending, startTransition] = useTransition()

  const handleSubmit = () => {
    startTransition(async () => {
      const { error } = await authClient.organization.updateMemberRole({
        memberId,
        role,
        organizationId,
      })

      if (error) {
        toast.error(error.message || "Не удалось изменить роль")
        return
      }

      toast.success(`Роль изменена на «${ORG_ROLE_LABEL[role] ?? role}» для ${memberName}`)
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Роль
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Назначить роль для {memberName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Текущая роль: <span className="text-foreground">{ORG_ROLE_LABEL[currentRole] ?? currentRole}</span>
          </p>
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Новая роль</label>
            <Select
              value={role}
              onValueChange={(val) =>
                setRole(val as "owner" | "admin" | "member")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Владелец</SelectItem>
                <SelectItem value="admin">Администратор</SelectItem>
                <SelectItem value="member">Участник</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <LoadingButton
              onClick={handleSubmit}
              className="w-full"
              loading={isPending}
            >
              Сохранить роль
            </LoadingButton>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
