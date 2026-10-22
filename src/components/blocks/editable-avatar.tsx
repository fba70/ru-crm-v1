"use client"

import { useRef } from "react"
import { Camera } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

// Крупная аватарка карточки профиля/организации. Если `onPick` передан —
// аватарка кликабельна: по наведению затемняется с подписью «Сменить фото»,
// по клику открывает выбор файла. Без `onPick` — просто картинка.
export function EditableAvatar({
  src,
  alt,
  fallback,
  onPick,
  label = "Сменить фото",
  className,
}: {
  src?: string | null
  alt: string
  fallback: string
  onPick?: (file: File) => void
  label?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const avatar = (
    // Толстое кольцо цвета рамок карточек (border-border) — отделяет аватарку
    // от фона карточки так же, как разделители. При наведении инициалы
    // гаснут, чтобы не спорить с подписью «Сменить фото».
    <Avatar className={cn("size-48 border-[10px] border-border", className)}>
      {/* src || undefined: пустая строка в src (у пользователя без фото
          user.image === "") заставляет браузер заново грузить страницу. */}
      <AvatarImage src={src || undefined} alt={alt} className="object-cover" />
      <AvatarFallback className="text-5xl transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
        {fallback}
      </AvatarFallback>
    </Avatar>
  )

  if (!onPick) return avatar

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={label}
        className="group relative cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {avatar}
        <span className="absolute inset-[10px] flex flex-col items-center justify-center gap-2 rounded-full bg-black/55 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera className="size-6" />
          {label}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png, image/jpeg, image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = "" // повторный выбор того же файла снова сработает
          if (file) onPick(file)
        }}
      />
    </>
  )
}
