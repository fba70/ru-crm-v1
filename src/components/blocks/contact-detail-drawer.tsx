"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ContactEditForm } from "@/components/forms/form-contact-edit"
import type { ContactRow } from "@/app/api/contacts/route"

// Дровер контакта — по образцу <ClientDetailDrawer>/<DealDetailDrawer>: клик
// на строку/карточку контакта открывает его здесь, сразу со всеми полями в
// режиме редактирования (не отдельная страница, не модалка). Переиспользует
// <ContactEditForm> целиком (те же поля/кнопка блокировки), а не дублирует
// разметку формы — дровер лишь даёт ей выезжающую рамку с заголовком.
export function ContactDetailDrawer({
  contact,
  open,
  onOpenChange,
  onChanged,
  canBlock = false,
}: {
  contact: ContactRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  canBlock?: boolean
}) {
  if (!contact) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0"
        // Иначе Radix при открытии автофокусит первое поле формы — см. тот
        // же фикс в client-detail-drawer.tsx/deal-detail-drawer.tsx.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="p-4 pb-3 border-b shrink-0">
          <SheetTitle>{contact.nameNative || contact.name}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <ContactEditForm
            mode="edit"
            contact={contact}
            canBlock={canBlock}
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
