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

export default function AdminSetRoleDialog({
  userId,
  userName,
  currentRole,
  onSuccess,
}: {
  userId: string
  userName: string
  currentRole: string
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<"user" | "admin">(
    (currentRole as "user" | "admin") || "user",
  )
  const [isPending, startTransition] = useTransition()

  const handleSubmit = () => {
    startTransition(async () => {
      const { error } = await authClient.admin.setRole({
        userId,
        role,
      })

      if (error) {
        toast.error(error.message || "Failed to set role")
        return
      }

      toast.success(`Role updated to "${role}" for ${userName}`)
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Role
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Set Role for {userName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Platform Role</label>
            <Select value={role} onValueChange={(val) => setRole(val as "user" | "admin")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <LoadingButton
              onClick={handleSubmit}
              className="w-full"
              loading={isPending}
            >
              Save Role
            </LoadingButton>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
