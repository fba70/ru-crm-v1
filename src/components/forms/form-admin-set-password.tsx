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

type SetPasswordFormData = {
  newPassword: string
  confirmPassword: string
}

export default function AdminSetPasswordDialog({
  userId,
  userName,
  onSuccess,
}: {
  userId: string
  userName: string
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const form = useForm<SetPasswordFormData>({
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  })

  const onSubmit = (data: SetPasswordFormData) => {
    if (data.newPassword !== data.confirmPassword) {
      toast.error("Passwords do not match")
      return
    }

    if (data.newPassword.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }

    startTransition(async () => {
      const { error } = await authClient.admin.setUserPassword({
        userId,
        newPassword: data.newPassword,
      })

      if (error) {
        toast.error(error.message || "Failed to set password")
        return
      }

      toast.success(`Password updated for ${userName}`)
      form.reset()
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Password
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Set Password for {userName}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">New Password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">
                    Confirm Password
                  </FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <LoadingButton type="submit" className="w-full" loading={isPending}>
                Set Password
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
