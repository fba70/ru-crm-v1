"use client"

import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
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
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import { toast } from "sonner"

type BanFormData = {
  banReason: string
  banDays: string
}

export default function AdminBanUserDialog({
  userId,
  userName,
  isBanned,
  onSuccess,
}: {
  userId: string
  userName: string
  isBanned: boolean
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const form = useForm<BanFormData>({
    defaultValues: {
      banReason: "",
      banDays: "7",
    },
  })

  const handleBan = (data: BanFormData) => {
    startTransition(async () => {
      const banExpiresIn = data.banDays
        ? parseInt(data.banDays) * 60 * 60 * 24
        : undefined

      const { error } = await authClient.admin.banUser({
        userId,
        banReason: data.banReason || undefined,
        banExpiresIn,
      })

      if (error) {
        toast.error(error.message || "Failed to ban user")
        return
      }

      toast.success(`${userName} has been banned`)
      form.reset()
      onSuccess?.()
      setOpen(false)
    })
  }

  const handleUnban = () => {
    startTransition(async () => {
      const { error } = await authClient.admin.unbanUser({
        userId,
      })

      if (error) {
        toast.error(error.message || "Failed to unban user")
        return
      }

      toast.success(`${userName} has been unbanned`)
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={isBanned ? "secondary" : "destructive"}
          size="sm"
        >
          {isBanned ? "Unban" : "Ban"}
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>
            {isBanned ? `Unban ${userName}` : `Ban ${userName}`}
          </DialogTitle>
        </DialogHeader>
        {isBanned ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              This will unban the user and allow them to sign in again.
            </p>
            <DialogFooter>
              <LoadingButton
                onClick={handleUnban}
                className="w-full"
                loading={isPending}
              >
                Unban User
              </LoadingButton>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleBan)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="banReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">
                      Ban Reason (optional)
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Violation of terms..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="banDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-400">
                      Ban Duration (days, empty = permanent)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" min="1" placeholder="7" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <LoadingButton
                  type="submit"
                  variant="destructive"
                  className="w-full"
                  loading={isPending}
                >
                  Ban User
                </LoadingButton>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
