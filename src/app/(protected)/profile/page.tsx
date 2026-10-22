"use client"

import { useEffect, useState } from "react"
import { BadgeCheck, BadgeAlert, Mail } from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/blocks/loading-button"
import ResetPasswordForm from "@/components/forms/form-reset-password"
import { PageHeaderActions } from "@/components/blocks/page-header-actions"
import { PageLoader } from "@/components/blocks/page-loader"
import { EditableAvatar } from "@/components/blocks/editable-avatar"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"
import { resizeImageToSquare } from "@/lib/image-resize"
import { isValidEmail } from "@/lib/orders-format"

type User = {
  id: string
  createdAt: Date
  email: string
  emailVerified: boolean
  name: string
  image?: string | null
  role?: string | null
}

function initialsOf(name: string | null | undefined) {
  if (!name) return "П"
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
}

// Профиль пользователя (пункт сайдбара с аватаркой). Две карточки на всю
// ширину и высоту страницы: слева имя, роль и крупная аватарка (клик —
// сменить фото), справа поля в один столбец, сразу в редактируемых
// контролах, и «Сохранить» в самом низу. Несохранённые изменения защищены
// диалогом при уходе со страницы (useUnsavedChangesGuard).
export default function ProfilePage() {
  const { data: session, refetch } = authClient.useSession()
  const user = session?.user as User | undefined

  if (!user) return <PageLoader className="min-h-screen" />
  return <ProfileForm key={user.id} user={user} onSaved={refetch} />
}

function ProfileForm({ user, onSaved }: { user: User; onSaved: () => void }) {
  // Email меняет только администратор платформы — через админский метод
  // better-auth (тот же, что в «Настройки → Пользователи»). Штатная смена
  // почты самим пользователем (user.changeEmail) в auth.ts не включена.
  const isAdmin = user.role === "admin"

  const [name, setName] = useState(user.name ?? "")
  const [email, setEmail] = useState(user.email ?? "")
  // Новое фото до сохранения: уже уменьшенная картинка + локальный предпросмотр.
  const [pendingAvatar, setPendingAvatar] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sendingVerification, setSendingVerification] = useState(false)

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  const trimmedName = name.trim()
  const trimmedEmail = email.trim().toLowerCase()
  const emailChanged = isAdmin && trimmedEmail !== (user.email ?? "").toLowerCase()
  const isDirty =
    trimmedName !== (user.name ?? "") || pendingAvatar !== null || emailChanged

  const save = async (): Promise<boolean> => {
    if (!trimmedName) {
      toast.error("Укажите имя")
      return false
    }
    if (emailChanged && !isValidEmail(trimmedEmail)) {
      toast.error("Укажите корректный email")
      return false
    }
    setSaving(true)
    try {
      let image: string | undefined
      if (pendingAvatar) {
        const res = await fetch("/api/profile/avatar", {
          method: "POST",
          headers: { "content-type": pendingAvatar.type },
          body: pendingAvatar,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.url) {
          toast.error(data.error ?? "Не удалось сохранить фото")
          return false
        }
        image = data.url
      }

      const { error } = await authClient.updateUser({
        name: trimmedName,
        ...(image ? { image } : {}),
      })
      if (error) {
        toast.error(error.message ?? "Не удалось сохранить профиль")
        return false
      }

      if (emailChanged) {
        // Новая почта ещё не подтверждена — помечаем и сразу отправляем на
        // неё письмо со ссылкой подтверждения.
        const { error: emailError } = await authClient.admin.updateUser({
          userId: user.id,
          data: { email: trimmedEmail, emailVerified: false },
        })
        if (emailError) {
          toast.error(emailError.message ?? "Не удалось сменить email")
          return false
        }
        await authClient.sendVerificationEmail({
          email: trimmedEmail,
          callbackURL: "/profile",
        })
        toast.success(`Email изменён. Письмо для подтверждения отправлено на ${trimmedEmail}`)
      } else {
        toast.success("Профиль сохранён")
      }

      setPendingAvatar(null)
      setPreview(null)
      onSaved()
      return true
    } finally {
      setSaving(false)
    }
  }

  const { dialog } = useUnsavedChangesGuard({ isDirty, onSave: save })

  const sendVerification = async () => {
    setSendingVerification(true)
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: user.email,
        callbackURL: "/profile",
      })
      if (error) toast.error(error.message ?? "Не удалось отправить письмо")
      else toast.success(`Письмо для подтверждения отправлено на ${user.email}`)
    } finally {
      setSendingVerification(false)
    }
  }

  const pickAvatar = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Выберите картинку: JPEG, PNG или WebP")
      return
    }
    try {
      const blob = await resizeImageToSquare(file)
      setPendingAvatar(blob)
      setPreview(URL.createObjectURL(blob))
    } catch {
      toast.error("Не удалось обработать картинку")
    }
  }

  const roleLabel = isAdmin ? "Администратор платформы" : "Пользователь"

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="truncate text-xl font-medium">Профиль</h1>
        <PageHeaderActions />
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card className="items-center justify-start gap-6 py-10 text-center">
          <div className="space-y-1 px-6">
            <div className="text-2xl font-semibold">{trimmedName || user.name}</div>
            <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {roleLabel}
            </div>
          </div>
          <EditableAvatar
            src={preview ?? user.image}
            alt={user.name ?? "Пользователь"}
            fallback={initialsOf(trimmedName || user.name)}
            onPick={pickAvatar}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-medium">Данные профиля</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-6">
            <div className="flex w-full flex-col gap-5 lg:w-1/2">
              <div className="space-y-2">
                <Label htmlFor="profile-name" className="text-muted-foreground">
                  Имя
                </Label>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-email" className="text-muted-foreground">
                  Email
                </Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={!isAdmin}
                />
                <p className="text-xs text-muted-foreground">
                  {isAdmin
                    ? "Email — логин для входа. После смены на новый адрес придёт письмо для подтверждения."
                    : "Email — логин для входа, его меняет администратор."}
                </p>
              </div>

              {/* Статус почты одной строкой, без отдельного заголовка —
                  «Email подтверждён: Не подтверждён» читалось противоречиво. */}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {user.emailVerified ? (
                  <span className="flex items-center gap-2">
                    <BadgeCheck className="size-5 text-green-500" />
                    Email подтверждён
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-2">
                      <BadgeAlert className="size-5 text-red-500" />
                      Email не подтверждён
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void sendVerification()}
                      disabled={sendingVerification}
                    >
                      <Mail />
                      Отправить письмо для подтверждения
                    </Button>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-created" className="text-muted-foreground">
                  Дата регистрации
                </Label>
                <Input
                  id="profile-created"
                  value={
                    user.createdAt
                      ? new Date(user.createdAt).toLocaleString("ru-RU")
                      : "—"
                  }
                  disabled
                />
              </div>

              <ResetPasswordForm />
            </div>

            <div className="mt-auto flex justify-start border-t pt-4">
              <LoadingButton
                onClick={() => void save()}
                loading={saving}
                disabled={!isDirty}
              >
                Сохранить
              </LoadingButton>
            </div>
          </CardContent>
        </Card>
      </div>

      {dialog}
    </div>
  )
}
