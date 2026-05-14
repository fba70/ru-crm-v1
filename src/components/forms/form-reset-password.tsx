"use client"

import { LoadingButton } from "@/components/blocks/loading-button"
import { PasswordInput } from "@/components/blocks/password-input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { passwordSchema } from "@/lib/validation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { authClient } from "@/lib/auth-client"
import { toast } from "sonner"

const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
  oldPassword: passwordSchema,
})

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

export default function ResetPasswordForm() {
  const [open, setOpen] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const router = useRouter()

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "", oldPassword: "" },
  })

  async function onSubmit({ newPassword, oldPassword }: ResetPasswordValues) {
    setSuccess(null)
    setError(null)

    startTransition(async () => {
      const { error } = await authClient.changePassword({
        newPassword: newPassword,
        currentPassword: oldPassword,
        revokeOtherSessions: true,
      })

      if (error) {
        setError(error.message || "Something went wrong")
        toast.error(error.message || "Something went wrong")
      } else {
        setSuccess("Password has been reset successfully!")
        toast.success("Password has been reset successfully!")
        setTimeout(() => {
          router.push("/sign-in")
        }, 2000)
      }

      form.reset()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="mt-4">
          Reset Password
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader className="mb-2">
          <DialogTitle>Reset Password</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      placeholder="Enter new password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="oldPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="current-password"
                      placeholder="Enter current password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {success && (
              <div role="status" className="text-sm text-green-600">
                {success}
              </div>
            )}
            {error && (
              <div role="alert" className="text-sm text-red-600">
                {error}
              </div>
            )}

            <DialogFooter>
              <LoadingButton
                type="submit"
                className="w-full"
                loading={isPending}
              >
                Reset password
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
