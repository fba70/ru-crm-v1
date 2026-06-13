"use client"

import { useEffect, useState } from "react"
import { authClient } from "@/lib/auth-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { BadgeCheck, BadgeAlert } from "lucide-react"
import UpdateUserDialog from "@/components/forms/form-edit-user"
import ResetPasswordForm from "@/components/forms/form-reset-password"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Separator } from "@/components/ui/separator"
import { PolarCustomerState } from "@/types/polar"
import { TableUserOrders } from "@/components/tables/table-user-orders"
import { TableUserUsage } from "@/components/tables/table-user-usage"
import { TableUserApiKeys } from "@/components/tables/table-user-api-keys"
import UpdateOrganizationDialog from "@/components/forms/form-edit-organization"
import { TableOrgMembers } from "@/components/tables/table-org-members"
import { InferSelectModel } from "drizzle-orm"
import { schema } from "@/db/schema"

type User = {
  id: string
  createdAt: Date
  updatedAt: Date
  email: string
  emailVerified: boolean
  name: string
  image?: string | null | undefined
}

type Organization = InferSelectModel<typeof schema.organization>

export default function AccountPage() {
  const { data: session, refetch } = authClient.useSession()
  const user = session?.user as User | undefined

  const [userState, setUserState] = useState<PolarCustomerState>()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [memberRole, setMemberRole] = useState<string | null>(null)
  const [orgKey, setOrgKey] = useState(0)

  //console.log("User session in settings page:", session)

  useEffect(() => {
    async function fetchUserState() {
      if (!user?.id) return
      try {
        const res = await fetch(
          `/api/auth/polar/state?id=${encodeURIComponent(user.id)}`,
        )
        const userState = await res.json()
        setUserState(userState)
        // console.log("Polar user state:", userState)
      } catch (e) {
        console.error("Failed to fetch Polar user state:", e)
      }
    }

    fetchUserState()
  }, [user?.id])

  useEffect(() => {
    async function fetchOrganization() {
      if (!user?.id) return
      try {
        const res = await fetch(
          `/api/organization?userId=${encodeURIComponent(user.id)}`,
        )
        const data = await res.json()
        setOrganization(data.organization)

        if (data.organization?.id) {
          const { data: members } = await authClient.organization.listMembers({
            query: { organizationId: data.organization.id },
          })
          const currentMember = members?.members?.find(
            (m: { userId: string }) => m.userId === user.id,
          )
          setMemberRole(currentMember?.role ?? null)
        }
      } catch (e) {
        console.error("Failed to fetch organization:", e)
      }
    }

    fetchOrganization()
  }, [user?.id, orgKey])

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">ЭККАУНТ</h1>

      <div className="flex flex-row gap-6 items-stretch justify-center w-full max-w-5xl">
        {user && (
          <Card className="w-1/2 flex flex-col">
            <CardHeader className="flex flex-row items-center gap-6 justify-start">
              <CardTitle className="text-xl font-medium">Пользователь:</CardTitle>
              <Avatar>
                <AvatarImage
                  src={user.image ?? undefined}
                  alt={user.name ?? "Пользователь"}
                />
                <AvatarFallback>
                  {user.name
                    ? user.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                    : "U"}
                </AvatarFallback>
              </Avatar>
              <CardTitle className="text-xl font-medium">{user.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 flex flex-1 flex-col">
              <div className="grid grid-cols-2 grid-rows-3 gap-2">
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  Email:
                </span>
                <span>{user.email}</span>
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  Email подтверждён:
                </span>
                <span>
                  {user.emailVerified ? (
                    <BadgeCheck className="inline-block text-green-500" />
                  ) : (
                    <BadgeAlert className="inline-block text-red-500" />
                  )}
                </span>
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  Дата регистрации:
                </span>
                <span>
                  {user.createdAt
                    ? new Date(user.createdAt).toLocaleString("ru-RU")
                    : "—"}
                </span>
              </div>

              <div className="mt-auto flex flex-row gap-4 items-center justify-center pt-4">
                <UpdateUserDialog user={user} onSuccess={refetch} />
                <ResetPasswordForm />
              </div>
            </CardContent>
          </Card>
        )}

        {organization && (
          <Card className="w-1/2 flex flex-col">
            <CardHeader className="flex flex-row items-center gap-6 justify-start">
              <CardTitle className="text-xl font-medium">
                Организация:
              </CardTitle>
              <Avatar>
                <AvatarImage
                  src={organization.logo ?? undefined}
                  alt={organization.name ?? "Организация"}
                />
                <AvatarFallback>
                  {organization.name
                    ? organization.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                    : "U"}
                </AvatarFallback>
              </Avatar>
              <CardTitle className="text-xl font-medium truncate">
                {organization.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 flex flex-1 flex-col">
              <div className="grid grid-cols-2 gap-2">
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  Название организации:
                </span>
                <span>{organization.name}</span>
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  Идентификатор (slug):
                </span>
                <span className="truncate">{organization.slug}</span>
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  ИНН:
                </span>
                <span>
                  {(() => {
                    try {
                      const parsed =
                        typeof organization.metadata === "string"
                          ? JSON.parse(organization.metadata)
                          : organization.metadata
                      return parsed?.taxId || "—"
                    } catch {
                      return "—"
                    }
                  })()}
                </span>
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  Веб-сайт:
                </span>
                <span className="truncate">
                  {organization.webUrl ? (
                    <a
                      href={organization.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {organization.webUrl}
                    </a>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  Адрес:
                </span>
                <span>{organization.address || "—"}</span>
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  Контактный email:
                </span>
                <span className="truncate">{organization.email || "—"}</span>
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  Контактный телефон:
                </span>
                <span>{organization.phone || "—"}</span>
              </div>

              {memberRole === "owner" && (
                <div className="mt-auto flex flex-row gap-4 items-center justify-center pt-4">
                  <UpdateOrganizationDialog
                    organization={organization}
                    onSuccess={() => setOrgKey((prev) => prev + 1)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {memberRole === "owner" && organization && user && (
        <>
          <Card className="w-full max-w-5xl">
            <CardHeader className="flex flex-row items-center gap-6 justify-start">
              <CardTitle className="text-xl font-medium">
                Участники организации
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TableOrgMembers
                organizationId={organization.id}
                currentUserId={user.id}
              />
            </CardContent>
          </Card>

          <Card className="w-full max-w-5xl">
            <CardHeader className="flex flex-row items-center gap-6 justify-start">
              <CardTitle className="text-xl font-medium">
                Управление API-ключами — ТОЛЬКО ПРЕДПРОСМОТР
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <TableUserApiKeys />
            </CardContent>
          </Card>

          <Card className="w-full max-w-5xl">
            <CardHeader className="flex flex-row items-center gap-6 justify-start">
              <CardTitle className="text-xl font-medium">
                Баланс счёта — ТОЛЬКО ПРЕДПРОСМОТР
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-row gap-4 items-center justify-start mb-6">
                <span className="font-medium dark:text-gray-400 text-gray-500">
                  Текущий баланс (EUR):
                </span>
                <span className="text-xl font-bold border border-gray-500 px-2 rounded-md">
                  12.30
                </span>
                <span className="font-medium dark:text-gray-400 text-gray-500 ml-8">
                  Текущий баланс (токены):
                </span>
                <span className="text-xl font-bold border border-gray-500 px-2 rounded-md">
                  1,230
                </span>
              </div>
              <Separator />
              <div>Купить кредиты</div>
              <div className="flex flex-row items-center justify-between">
                <div className="border-2 border-gray-200 dark:border-gray-700 rounded-md py-4 px-6">
                  <div className="grid grid-cols-2 grid-rows-4 gap-x-6 gap-y-2">
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Продукт:
                    </span>
                    <span className="font-bold text-lime-600 border border-gray-500 px-2 rounded-md text-center">
                      STARTER
                    </span>
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Цена (EUR):
                    </span>
                    <span>20.00</span>
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Монеты:
                    </span>
                    <span>2,000</span>
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Тип покупки:
                    </span>
                    <span>Разовая</span>
                  </div>
                  <div className="flex flex-row gap-4 items-center justify-center mt-6">
                    <Link
                      href="https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_L6wreTRQmMcJQeLVILkTtzuDkb0DOe41PZffJ3jNxv8/redirect"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button>Купить</Button>
                    </Link>
                  </div>
                </div>
                <div className="border-2 border-gray-200 dark:border-gray-700 rounded-md py-4 px-6">
                  <div className="grid grid-cols-2 grid-rows-4 gap-x-6 gap-y-2">
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Продукт:
                    </span>
                    <span className="font-bold text-blue-500 border border-gray-500 px-2 rounded-md text-center">
                      PRO
                    </span>
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Цена (EUR):
                    </span>
                    <span>100.00</span>
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Монеты:
                    </span>
                    <span>10,000</span>
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Тип покупки:
                    </span>
                    <span>Разовая</span>
                  </div>
                  <div className="flex flex-row gap-4 items-center justify-center mt-6">
                    <Link
                      href="https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_L6wreTRQmMcJQeLVILkTtzuDkb0DOe41PZffJ3jNxv8/redirect"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button>Купить</Button>
                    </Link>
                  </div>
                </div>
                <div className="border-2 border-gray-200 dark:border-gray-700 rounded-md py-4 px-6">
                  <div className="grid grid-cols-2 grid-rows-4 gap-x-6 gap-y-2">
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Продукт:
                    </span>
                    <span className="font-bold text-pink-500 border border-gray-500 px-2 rounded-md text-center">
                      ULTIMATE
                    </span>
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Цена (EUR):
                    </span>
                    <span>500.00</span>
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Монеты:
                    </span>
                    <span>50,000</span>
                    <span className="font-medium dark:text-gray-400 text-gray-500">
                      Тип покупки:
                    </span>
                    <span>Разовая</span>
                  </div>
                  <div className="flex flex-row gap-4 items-center justify-center mt-6">
                    <Link
                      href="https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_L6wreTRQmMcJQeLVILkTtzuDkb0DOe41PZffJ3jNxv8/redirect"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button>Купить</Button>
                    </Link>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="w-full max-w-5xl">
            <CardHeader className="flex flex-row items-center gap-6 justify-start">
              <CardTitle className="text-xl font-medium">
                История покупок — ТОЛЬКО ПРЕДПРОСМОТР
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <TableUserOrders userId={userState?.id} />
            </CardContent>
          </Card>

          <Card className="w-full max-w-5xl">
            <CardHeader className="flex flex-row items-center gap-6 justify-start">
              <CardTitle className="text-xl font-medium">
                История использования — ТОЛЬКО ПРЕДПРОСМОТР
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <TableUserUsage />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
