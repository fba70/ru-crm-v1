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
import { authClient } from "@/lib/auth-client"
import { toast } from "sonner"

export default function RemoveMemberDialog({
  memberId,
  memberName,
  onSuccess,
}: {
  memberId: string
  memberName: string
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleRemove = () => {
    startTransition(async () => {
      const { error } = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
      })

      if (error) {
        toast.error(error.message || "Не удалось удалить участника")
        return
      }

      toast.success(`${memberName} удалён из организации`)
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Удалить
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Удалить {memberName}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-500">
          Вы уверены, что хотите удалить <strong>{memberName}</strong> из
          организации? Пользователь потеряет доступ ко всем ресурсам
          организации.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <LoadingButton
            variant="destructive"
            onClick={handleRemove}
            loading={isPending}
          >
            Удалить
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
