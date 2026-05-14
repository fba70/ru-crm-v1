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

type AdminUser = {
  id: string
  name: string
  email: string
}

type UpdateUserFormData = {
  name: string
  email: string
}

export default function AdminEditUserDialog({
  user,
  onSuccess,
}: {
  user: AdminUser
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const form = useForm<UpdateUserFormData>({
    defaultValues: {
      name: user.name || "",
      email: user.email || "",
    },
  })

  const onSubmit = (data: UpdateUserFormData) => {
    startTransition(async () => {
      const { error } = await authClient.admin.updateUser({
        userId: user.id,
        data: {
          name: data.name,
          email: data.email,
        },
      })

      if (error) {
        toast.error(error.message || "Failed to update user")
        return
      }

      toast.success("User updated successfully")
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <LoadingButton type="submit" className="w-full" loading={isPending}>
                Save
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
