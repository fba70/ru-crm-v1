"use client"

import { useState, useTransition } from "react"
import Image from "next/image"
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

type User = {
  id: string
  createdAt: Date
  updatedAt: Date
  email: string
  emailVerified: boolean
  name: string
  image?: string | null | undefined
}

type UpdateUserFormData = {
  name: string
  image: string
}

export default function UpdateUserDialog({
  user,
  onSuccess,
}: {
  user: User
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const [imagePreview, setImagePreview] = useState(user.image || "")

  const form = useForm<UpdateUserFormData>({
    defaultValues: {
      name: user.name || "",
      image: user.image || "",
    },
  })

  const { setValue } = form

  const onSubmit = (data: UpdateUserFormData) => {
    setSuccess(null)
    setError(null)

    startTransition(async () => {
      await authClient.updateUser({
        name: data.name,
        image: data.image,
      })

      if (error) {
        setError(error || "Something went wrong")
        toast.error(error || "Something went wrong")
      } else {
        if (onSuccess) onSuccess()
        setSuccess("User data has been updated successfully!")
        toast.success("User data has been updated successfully!")
      }

      form.reset()
      setOpen(false)
    })
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      alert("Only PNG or JPEG allowed")
      return
    }
    if (file.size > 300 * 1024) {
      alert("File must be less than 300kb")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result as string
      setValue("image", base64)
      setImagePreview(base64)
    }
    reader.readAsDataURL(file)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" className="mt-4">
          Edit User Profile
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader className="mb-2">
          <DialogTitle>Edit User Profile</DialogTitle>
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
                    <Input id="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="image"
              render={() => (
                <FormItem>
                  <FormLabel className="text-gray-400">Profile Image</FormLabel>
                  <FormControl>
                    <Input
                      id="image"
                      type="file"
                      accept="image/png, image/jpeg"
                      onChange={handleImageChange}
                    />
                  </FormControl>
                  {imagePreview && (
                    <Image
                      src={imagePreview}
                      alt="Preview"
                      width={64}
                      height={64}
                      unoptimized
                      className="mt-2 w-16 h-16 rounded-full object-cover"
                    />
                  )}
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
                Save
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
