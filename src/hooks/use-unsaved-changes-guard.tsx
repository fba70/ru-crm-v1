"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

// Защита несохранённой формы страницы (профиль, организация).
//
// • Переход по ссылке внутри приложения (сайдбар, ссылки на странице) —
//   перехватываем клик в фазе capture на document, раньше обработчика
//   next/link, и показываем свой диалог «Сохранить / Не сохранять / Отмена»
//   (тот же, что в дровере сделки).
// • Обновление / закрытие вкладки — браузер разрешает только своё
//   стандартное предупреждение (beforeunload), свой диалог туда не вставить.
//
// Переходы, сделанные кодом через router.push (например, выбор результата в
// глобальном поиске), этим не перехватываются — в App Router нет API
// блокировки навигации.
export function useUnsavedChangesGuard({
  isDirty,
  onSave,
}: {
  isDirty: boolean
  // Возвращает true, если сохранение удалось и можно уходить.
  onSave: () => Promise<boolean>
}) {
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dirtyRef = useRef(isDirty)

  useEffect(() => {
    dirtyRef.current = isDirty
  }, [isDirty])

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = (e.target as Element | null)?.closest?.("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.target && anchor.target !== "_self") return
      if (anchor.hasAttribute("download")) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      const sameLocation =
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash === window.location.hash
      if (sameLocation) return
      e.preventDefault()
      e.stopPropagation()
      setPendingHref(anchor.getAttribute("href"))
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])

  const leave = (href: string) => {
    dirtyRef.current = false
    setPendingHref(null)
    router.push(href)
  }

  const dialog = (
    <AlertDialog
      open={pendingHref !== null}
      onOpenChange={(open) => {
        if (!open && !saving) setPendingHref(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Сохранить изменения?</AlertDialogTitle>
          <AlertDialogDescription>
            На странице есть несохранённые изменения. Если уйти без сохранения,
            они пропадут.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Отмена</AlertDialogCancel>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => pendingHref && leave(pendingHref)}
          >
            Не сохранять
          </Button>
          <AlertDialogAction
            disabled={saving}
            onClick={async (e) => {
              e.preventDefault()
              if (!pendingHref) return
              setSaving(true)
              const ok = await onSave()
              setSaving(false)
              if (ok) leave(pendingHref)
              else setPendingHref(null)
            }}
          >
            Сохранить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { dialog }
}
