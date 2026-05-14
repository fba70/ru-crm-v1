"use client"

import { useState, useTransition, useEffect } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import { Streamdown } from "streamdown"
import { toast } from "sonner"
import type { RuleRow } from "@/app/api/rules/route"
import type { RuleType } from "@/db/schema"

type RuleFormData = {
  name: string
  content: string
}

type Props = {
  mode: "create" | "edit"
  ruleType: RuleType
  rule?: RuleRow
  canEdit: boolean
  trigger: React.ReactNode
  onSuccess?: () => void
}

export default function RuleEditDialog({
  mode,
  ruleType,
  rule,
  canEdit,
  trigger,
  onSuccess,
}: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const form = useForm<RuleFormData>({
    defaultValues: {
      name: rule?.name ?? "",
      content: rule?.content ?? "",
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: rule?.name ?? "",
        content: rule?.content ?? "",
      })
    }
  }, [open, rule, form])

  const contentValue = form.watch("content")

  const onSubmit = (data: RuleFormData) => {
    if (!canEdit) {
      setOpen(false)
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/rules", {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "create"
              ? { name: data.name, content: data.content, type: ruleType }
              : { id: rule!.id, name: data.name, content: data.content },
          ),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Failed to save rule")
          return
        }
        toast.success(mode === "create" ? "Rule created" : "Rule updated")
        onSuccess?.()
        setOpen(false)
      } catch {
        toast.error("Failed to save rule")
      }
    })
  }

  const title =
    mode === "create"
      ? `New ${ruleType} rule`
      : canEdit
        ? `Edit rule: ${rule?.name ?? ""}`
        : `View rule: ${rule?.name ?? ""}`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-[66vw]! w-[66vw] max-h-[90vh] flex flex-col dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 flex-1 min-h-0 flex flex-col overflow-hidden"
          >
            <FormField
              control={form.control}
              name="name"
              rules={{ required: "Name is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-400">Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={!canEdit}
                      placeholder="Rule name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem className="flex-1 min-h-0 flex flex-col">
                  <FormLabel className="text-gray-400">Content</FormLabel>
                  <Tabs
                    defaultValue="edit"
                    className="flex-1 min-h-0 flex flex-col"
                  >
                    <TabsList>
                      <TabsTrigger value="edit">Edit</TabsTrigger>
                      <TabsTrigger value="preview">Preview</TabsTrigger>
                    </TabsList>
                    <TabsContent
                      value="edit"
                      className="flex-1 min-h-0 mt-2"
                    >
                      <FormControl>
                        <Textarea
                          {...field}
                          disabled={!canEdit}
                          placeholder="Write markdown content..."
                          className="font-mono text-sm h-64 resize-none"
                        />
                      </FormControl>
                    </TabsContent>
                    <TabsContent
                      value="preview"
                      className="flex-1 min-h-0 mt-2 overflow-auto rounded-md border p-4 h-64"
                    >
                      {contentValue ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <Streamdown>{contentValue}</Streamdown>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          Nothing to preview.
                        </p>
                      )}
                    </TabsContent>
                  </Tabs>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {canEdit ? "Cancel" : "Close"}
              </Button>
              {canEdit && (
                <LoadingButton type="submit" loading={isPending}>
                  {mode === "create" ? "Create" : "Save"}
                </LoadingButton>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
