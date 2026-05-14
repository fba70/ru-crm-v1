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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { Copy, Check } from "lucide-react"

type ApiKey = {
  name: string
  expiresIn: number
  prefix: string
  // description: string
}

const expirationOptions = [
  { label: "1 month (default)", value: 60 * 60 * 24 * 30 },
  { label: "1 year", value: 60 * 60 * 24 * 365 },
  { label: "Never", value: 60 * 60 * 24 * 7300 },
]

export default function CreateApiKeyDialog({
  onSuccess,
}: {
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const form = useForm<ApiKey>({
    defaultValues: {
      name: "My API key",
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      prefix: "PROJECT_",
      // description: "",
    },
  })

  const { setValue } = form

  const onSubmit = (formData: ApiKey) => {
    setSuccess(null)
    setError(null)

    startTransition(async () => {
      const { data, error } = await authClient.apiKey.create({
        name: formData.name,
        expiresIn: formData.expiresIn,
        prefix: formData.prefix || "PROJECT_",
        // metadata: { description: formData.description },
      })

      if (error) {
        setError(error.message || "Something went wrong")
        toast.error(error.message || "Something went wrong")
      } else {
        setApiKey(data?.key || null)
        console.log("Created API key:", data)
        if (onSuccess) onSuccess()
        setSuccess("User data has been updated successfully!")
        toast.success("User data has been updated successfully!")
      }

      // form.reset()
      // setOpen(false)
    })
  }

  const copyToClipboard = async () => {
    if (apiKey) {
      await navigator.clipboard.writeText(apiKey)
      setCopied(true)
      toast.success("API key copied to clipboard!")
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" className="">
          Add New API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader className="mb-2">
          <DialogTitle>Add New API Key</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">API key name</FormLabel>
                  <FormControl>
                    <Input id="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="expiresIn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Expiration</FormLabel>
                  <Select
                    onValueChange={(value) =>
                      setValue("expiresIn", parseInt(value))
                    }
                    value={field.value.toString()}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select expiration" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {expirationOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value.toString()}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                Generate
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>

        {apiKey && (
          <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-md">
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
              <strong>Important:</strong> This API key will only be shown once.
              Make sure to copy it now as it cannot be retrieved later.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={apiKey}
                readOnly
                className="flex-1 text-green-600 text-sm"
              />
              <Button onClick={copyToClipboard} variant="outline" size="sm">
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {apiKey && (
          <Button
            onClick={() => {
              setOpen(false)
              form.reset()
              setApiKey(null)
              setSuccess(null)
              setError(null)
            }}
            className="w-full mt-4"
          >
            Close
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
