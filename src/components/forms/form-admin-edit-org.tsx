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
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import { toast } from "sonner"
import type { AdminOrg } from "@/app/api/admin/organizations/route"

type EditOrgFormData = {
  name: string
  slug: string
  taxId: string
  webUrl: string
  address: string
  email: string
  phone: string
  logo: string
}

export default function AdminEditOrgDialog({
  org,
  onSuccess,
}: {
  org: AdminOrg
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [imagePreview, setImagePreview] = useState(org.logo || "")

  const parsedTaxId = (() => {
    try {
      const parsed =
        typeof org.metadata === "string"
          ? JSON.parse(org.metadata)
          : org.metadata
      return parsed?.taxId || ""
    } catch {
      return ""
    }
  })()

  const form = useForm<EditOrgFormData>({
    defaultValues: {
      name: org.name || "",
      slug: org.slug || "",
      taxId: parsedTaxId,
      webUrl: org.webUrl || "",
      address: org.address || "",
      email: org.email || "",
      phone: org.phone || "",
      logo: org.logo || "",
    },
  })

  const { setValue } = form

  const onSubmit = (data: EditOrgFormData) => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/organizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: org.id,
            name: data.name,
            slug: data.slug,
            logo: data.logo,
            taxId: data.taxId,
            webUrl: data.webUrl,
            address: data.address,
            email: data.email,
            phone: data.phone,
          }),
        })

        if (!res.ok) {
          const err = await res.json()
          toast.error(err.error || "Не удалось обновить организацию")
          return
        }

        toast.success("Организация обновлена")
        onSuccess?.()
        setOpen(false)
      } catch {
        toast.error("Не удалось обновить организацию")
      }
    })
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      toast.error("Допустимы только PNG или JPEG")
      return
    }
    if (file.size > 300 * 1024) {
      toast.error("Файл должен быть меньше 300 КБ")
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
        <Button variant="outline" size="sm">
          Изменить
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Редактировать организацию: {org.name}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Название</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                  <FormLabel className="text-gray-400">Идентификатор (slug)</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                  <FormLabel className="text-gray-400">ИНН</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                  <FormLabel className="text-gray-400">Веб-сайт</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com" {...field} />
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
                  <FormLabel className="text-gray-400">Адрес</FormLabel>
                  <FormControl>
                    <Input placeholder="Улица, город, страна" {...field} />
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
                  <FormLabel className="text-gray-400">Контактный email</FormLabel>
                  <FormControl>
                    <Input
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
                  <FormLabel className="text-gray-400">Контактный телефон</FormLabel>
                  <FormControl>
                    <Input
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
                  <FormLabel className="text-gray-400">Логотип</FormLabel>
                  <FormControl>
                    <Input
                      type="file"
                      accept="image/png, image/jpeg"
                      onChange={handleImageChange}
                    />
                  </FormControl>
                  {imagePreview && (
                    <Image
                      src={imagePreview}
                      alt="Предпросмотр"
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
            <DialogFooter>
              <LoadingButton type="submit" className="w-full" loading={isPending}>
                Сохранить
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
