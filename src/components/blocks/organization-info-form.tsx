"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Fingerprint } from "lucide-react"
import type { InferSelectModel } from "drizzle-orm"
import type { schema } from "@/db/schema"
import { authClient } from "@/lib/auth-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/blocks/loading-button"
import { EditableAvatar } from "@/components/blocks/editable-avatar"
import { OrgIdentityDialog } from "@/components/blocks/org-identity-dialog"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"
import { blobToDataUrl, resizeImageToSquare } from "@/lib/image-resize"

type Organization = InferSelectModel<typeof schema.organization>

type Values = {
  name: string
  slug: string
  taxId: string
  webUrl: string
  address: string
  email: string
  phone: string
  logo: string
}

const FIELDS: {
  key: Exclude<keyof Values, "logo">
  label: string
  placeholder?: string
  type?: string
}[] = [
  { key: "name", label: "Название организации" },
  { key: "slug", label: "Идентификатор (slug)" },
  { key: "taxId", label: "ИНН" },
  { key: "webUrl", label: "Веб-сайт", placeholder: "https://example.com" },
  { key: "address", label: "Адрес", placeholder: "Улица, город, страна" },
  { key: "email", label: "Контактный email", placeholder: "hello@example.com", type: "email" },
  { key: "phone", label: "Контактный телефон", placeholder: "+7 999 000 0000", type: "tel" },
]

function taxIdOf(org: Organization): string {
  try {
    const parsed =
      typeof org.metadata === "string" ? JSON.parse(org.metadata) : org.metadata
    return parsed?.taxId || ""
  } catch {
    return ""
  }
}

function valuesOf(org: Organization): Values {
  return {
    name: org.name || "",
    slug: org.slug || "",
    taxId: taxIdOf(org),
    webUrl: org.webUrl || "",
    address: org.address || "",
    email: org.email || "",
    phone: org.phone || "",
    logo: org.logo || "",
  }
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "О"
  )
}

// Вкладка «Информация об организации»: слева название, slug и крупный логотип
// (клик — сменить), справа все поля сразу в редактируемых контролах и
// «Сохранить» внизу. Редактирует только владелец; остальным те же поля
// показываются только для чтения. Поля — в один столбец, «Сохранить» в
// самом низу; обе карточки растянуты по ширине и высоте страницы. Логотип хранится data URL в
// organization.logo — в куку сессии он не попадает (сайдбар грузит его на
// сервере), поэтому, в отличие от фото профиля, R2 не нужен.
export function OrganizationInfoForm({
  organization,
  canEdit,
  onSaved,
}: {
  organization: Organization
  canEdit: boolean
  onSaved: (patch: Partial<Organization>) => void
}) {
  const router = useRouter()
  const [baseline, setBaseline] = useState<Values>(() => valuesOf(organization))
  const [values, setValues] = useState<Values>(baseline)
  const [saving, setSaving] = useState(false)

  const isDirty =
    canEdit &&
    (Object.keys(values) as (keyof Values)[]).some(
      (k) => values[k].trim() !== baseline[k].trim(),
    )

  const set = (key: keyof Values, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const save = async (): Promise<boolean> => {
    const next = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.trim()]),
    ) as Values
    if (!next.name) {
      toast.error("Укажите название организации")
      return false
    }
    if (!next.slug) {
      toast.error("Укажите идентификатор (slug)")
      return false
    }
    setSaving(true)
    try {
      if (next.slug !== baseline.slug) {
        const { data: available, error: slugError } =
          await authClient.organization.checkSlug({ slug: next.slug })
        if (slugError) {
          toast.error(slugError.message || "Не удалось проверить идентификатор")
          return false
        }
        if (!available) {
          toast.error("Этот идентификатор уже занят другой организацией")
          return false
        }
      }
      const { error } = await authClient.organization.update({
        data: {
          name: next.name,
          slug: next.slug,
          metadata: { taxId: next.taxId },
          webUrl: next.webUrl,
          address: next.address,
          email: next.email,
          phone: next.phone,
          logo: next.logo,
        },
        organizationId: organization.id,
      })
      if (error) {
        toast.error(error.message || "Не удалось сохранить организацию")
        return false
      }
      setBaseline(next)
      setValues(next)
      onSaved({
        name: next.name,
        slug: next.slug,
        webUrl: next.webUrl,
        address: next.address,
        email: next.email,
        phone: next.phone,
        logo: next.logo,
        metadata: JSON.stringify({ taxId: next.taxId }),
      })
      // Логотип и название в сайдбаре берутся на сервере — перерисовываем.
      router.refresh()
      toast.success("Данные организации сохранены")
      return true
    } finally {
      setSaving(false)
    }
  }

  const { dialog } = useUnsavedChangesGuard({ isDirty, onSave: save })

  const pickLogo = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Выберите картинку: JPEG, PNG или WebP")
      return
    }
    try {
      set("logo", await blobToDataUrl(await resizeImageToSquare(file)))
    } catch {
      toast.error("Не удалось обработать картинку")
    }
  }

  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <Card className="items-center justify-start gap-6 py-10 text-center">
        <div className="space-y-1 px-6">
          <div className="text-2xl font-semibold">{values.name || organization.name}</div>
          <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            {values.slug || organization.slug}
          </div>
        </div>
        <EditableAvatar
          src={values.logo || null}
          alt={organization.name ?? "Организация"}
          fallback={initialsOf(values.name || organization.name || "")}
          onPick={canEdit ? pickLogo : undefined}
          label="Сменить логотип"
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium">Данные организации</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-6">
          <div className="flex w-full flex-col gap-5 lg:w-1/2">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-2">
                <Label htmlFor={`org-${f.key}`} className="text-muted-foreground">
                  {f.label}
                </Label>
                <Input
                  id={`org-${f.key}`}
                  type={f.type ?? "text"}
                  placeholder={canEdit ? f.placeholder : undefined}
                  value={values[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  disabled={!canEdit}
                />
              </div>
            ))}

            {canEdit && (
              // Own-organisation identity registry: extra names / websites /
              // addresses used to recognise US during source parsing (see
              // src/app/CLAUDE.md). Owner-only.
              <OrgIdentityDialog
                trigger={
                  <Button variant="outline" className="w-fit">
                    <Fingerprint />
                    Своя организация
                  </Button>
                }
                organizationName={baseline.name}
                organizationWebUrl={baseline.webUrl || null}
                organizationAddress={baseline.address || null}
              />
            )}
          </div>

          {canEdit && (
            <div className="mt-auto flex justify-start border-t pt-4">
              <LoadingButton onClick={() => void save()} loading={saving} disabled={!isDirty}>
                Сохранить
              </LoadingButton>
            </div>
          )}
        </CardContent>
      </Card>

      {dialog}
    </div>
  )
}
