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
        toast.error(error.message || "Failed to remove member")
        return
      }

      toast.success(`${memberName} has been removed from the organization`)
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Remove {memberName}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-500">
          Are you sure you want to remove <strong>{memberName}</strong> from the
          organization? They will lose access to all organization resources.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <LoadingButton
            variant="destructive"
            onClick={handleRemove}
            loading={isPending}
          >
            Remove
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
