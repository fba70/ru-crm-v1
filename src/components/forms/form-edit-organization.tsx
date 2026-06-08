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
import { InferSelectModel } from "drizzle-orm"
import { schema } from "@/db/schema"
import { toast } from "sonner"

type Organization = InferSelectModel<typeof schema.organization>

type UpdateOrganizationFormData = {
  name: string
  slug: string
  taxId: string
  webUrl: string
  address: string
  email: string
  phone: string
  logo: string
}

export default function UpdateOrganizationDialog({
  organization,
  onSuccess,
}: {
  organization: Organization
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const [imagePreview, setImagePreview] = useState(organization.logo || "")

  const form = useForm<UpdateOrganizationFormData>({
    defaultValues: {
      name: organization.name || "",
      slug: organization.slug || "",
      taxId: (() => {
        try {
          const parsed =
            typeof organization.metadata === "string"
              ? JSON.parse(organization.metadata)
              : organization.metadata
          return parsed?.taxId || ""
        } catch {
          return ""
        }
      })(),
      webUrl: organization.webUrl || "",
      address: organization.address || "",
      email: organization.email || "",
      phone: organization.phone || "",
      logo: organization.logo || "",
    },
  })

  const { setValue } = form

  const onSubmit = (data: UpdateOrganizationFormData) => {
    setSuccess(null)
    setError(null)

    startTransition(async () => {
      // Check if the slug is available (only if it changed)
      if (data.slug !== organization.slug) {
        const { data: slugAvailable, error: slugError } =
          await authClient.organization.checkSlug({
            slug: data.slug,
          })

        if (slugError) {
          setError(slugError.message || "Error checking slug availability")
          toast.error(slugError.message || "Error checking slug availability")
          return
        }

        if (!slugAvailable) {
          setError("Slug is already taken by another organization")
          return
        }
      }

      // Proceed with the update
      const { error } = await authClient.organization.update({
        data: {
          name: data.name,
          slug: data.slug,
          metadata: { taxId: data.taxId },
          webUrl: data.webUrl,
          address: data.address,
          email: data.email,
          phone: data.phone,
          logo: data.logo,
        },
        organizationId: organization.id,
      })

      if (error) {
        setError(error.message || "Something went wrong")
      } else {
        if (onSuccess) onSuccess()
        setSuccess("Organization data has been updated successfully!")
        toast.success("Organization data has been updated successfully!")
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
      setValue("logo", base64)
      setImagePreview(base64)
    }
    reader.readAsDataURL(file)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" className="mt-4">
          Edit Organization Profile
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader className="mb-2">
          <DialogTitle>Edit Organization Profile</DialogTitle>
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
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Slug</FormLabel>
                  <FormControl>
                    <Input id="slug" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="taxId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Tax ID</FormLabel>
                  <FormControl>
                    <Input id="taxId" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="webUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Website</FormLabel>
                  <FormControl>
                    <Input
                      id="webUrl"
                      placeholder="https://example.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Address</FormLabel>
                  <FormControl>
                    <Input
                      id="address"
                      placeholder="Street, city, country"
                      {...field}
                    />
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
                  <FormLabel className="text-gray-400">
                    Contact email
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="email"
                      type="email"
                      placeholder="hello@example.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">
                    Contact phone
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+1 555 000 0000"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="logo"
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
