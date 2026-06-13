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
import { toast } from "sonner"
import type { UserOrgInfo } from "@/app/api/admin/user-organizations/route"

// Display labels — DB enum keys stay English.
const ORG_ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
}

export default function AdminSetOrgRoleDialog({
  userName,
  orgDetails,
  onSuccess,
}: {
  userName: string
  orgDetails: UserOrgInfo[]
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [selectedMemberId, setSelectedMemberId] = useState(
    orgDetails[0]?.memberId ?? "",
  )
  const [role, setRole] = useState<"owner" | "admin" | "member">(
    (orgDetails[0]?.orgRole as "owner" | "admin" | "member") ?? "member",
  )

  const selectedOrg = orgDetails.find((o) => o.memberId === selectedMemberId)

  const handleOrgChange = (memberId: string) => {
    setSelectedMemberId(memberId)
    const org = orgDetails.find((o) => o.memberId === memberId)
    if (org) {
      setRole((org.orgRole as "owner" | "admin" | "member") ?? "member")
    }
  }

  const handleSubmit = () => {
    if (!selectedMemberId) return

    startTransition(async () => {
      try {
        // Admin path goes through our server route (requireAdmin + direct DB),
        // NOT the better-auth org plugin — that authorizes against the caller's
        // own membership in the org, so a platform admin who isn't a member of
        // the target org gets "member not found".
        const res = await fetch("/api/admin/user-organizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "setRole",
            memberId: selectedMemberId,
            role,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || "Не удалось изменить роль в организации")
          return
        }
        toast.success(
          `Роль в организации изменена на «${ORG_ROLE_LABEL[role] ?? role}» для ${userName} в ${selectedOrg?.organizationName}`,
        )
        onSuccess?.()
        setOpen(false)
      } catch {
        toast.error("Не удалось изменить роль в организации")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Роль в орг.
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Роль в организации для {userName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {orgDetails.length > 1 && (
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Организация</label>
              <Select
                value={selectedMemberId}
                onValueChange={handleOrgChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {orgDetails.map((org) => (
                    <SelectItem key={org.memberId} value={org.memberId}>
                      {org.organizationName} ({ORG_ROLE_LABEL[org.orgRole] ?? org.orgRole})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {orgDetails.length === 1 && (
            <p className="text-sm text-gray-400">
              Организация: <span className="text-foreground">{orgDetails[0].organizationName}</span>{" "}
              (текущая роль: <span className="text-foreground">{ORG_ROLE_LABEL[orgDetails[0].orgRole] ?? orgDetails[0].orgRole}</span>)
            </p>
          )}

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
