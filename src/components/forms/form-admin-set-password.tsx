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
      toast.error("Пароли не совпадают")
      return
    }

    if (data.newPassword.length < 8) {
      toast.error("Пароль должен содержать не менее 8 символов")
      return
    }

    startTransition(async () => {
      const { error } = await authClient.admin.setUserPassword({
        userId,
        newPassword: data.newPassword,
      })

      if (error) {
        toast.error(error.message || "Не удалось установить пароль")
        return
      }

      toast.success(`Пароль обновлён для ${userName}`)
      form.reset()
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Пароль
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Установить пароль для {userName}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Новый пароль</FormLabel>
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
                    Подтвердите пароль
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
                Установить пароль
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
