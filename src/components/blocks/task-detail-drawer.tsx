"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { TaskEditForm } from "@/components/forms/form-task-edit"
import type { TaskRow } from "@/app/api/tasks/route"

// Дровер задачи — по образцу <ClientDetailDrawer>/<DealDetailDrawer>: клик
// на карточку задачи открывает её здесь, сразу со всеми полями в режиме
// редактирования. Переиспользует <TaskEditForm> целиком, не дублирует поля.
export function TaskDetailDrawer({
  task,
  open,
  onOpenChange,
  onChanged,
}: {
  task: TaskRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  if (!task) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0"
        // Иначе Radix при открытии автофокусит первое поле формы — см. тот
        // же фикс в client-detail-drawer.tsx/deal-detail-drawer.tsx.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="p-4 pb-3 border-b shrink-0">
          <SheetTitle>{task.name}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <TaskEditForm
            mode="edit"
            task={task}
            onSuccess={() => {
              onChanged()
              onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
