"use client"

import { useEffect, useState } from "react"
import { authClient } from "@/lib/auth-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Separator } from "@/components/ui/separator"
import { PolarCustomerState } from "@/types/polar"
import { TableUserOrders } from "@/components/tables/table-user-orders"
import { TableUserUsage } from "@/components/tables/table-user-usage"
import { TableUserApiKeys } from "@/components/tables/table-user-api-keys"
import { OrganizationInfoForm } from "@/components/blocks/organization-info-form"
import { TableOrgMembers } from "@/components/tables/table-org-members"
import { InferSelectModel } from "drizzle-orm"
import { schema } from "@/db/schema"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeaderActions } from "@/components/blocks/page-header-actions"
import { PageLoader } from "@/components/blocks/page-loader"

type User = {
  id: string
  createdAt: Date
  updatedAt: Date
  email: string
  emailVerified: boolean
  name: string
  image?: string | null | undefined
}

// Billing + API-key surfaces are BUILT BUT NOT IN PRODUCTION. They are hidden
// for every organisation until the Polar billing flow actually goes live —
// their markup and the tables they render are deliberately kept, not deleted.
// Flip this to `true` to bring all four cards back at once:
//   • Управление API-ключами   • Баланс счёта
//   • История покупок          • История использования
// (Typed as `boolean` on purpose so the JSX below is not analysed as dead.)
const SHOW_PREVIEW_BILLING_BLOCKS: boolean = false

type Organization = InferSelectModel<typeof schema.organization>

export default function AccountPage() {
  const { data: session } = authClient.useSession()
  const user = session?.user as User | undefined

  const [userState, setUserState] = useState<PolarCustomerState>()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [memberRole, setMemberRole] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

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
      // Организация и роль текущего пользователя грузятся ПАРАЛЛЕЛЬНО, и
      // страница показывается, только когда пришли оба ответа: раньше роль
      // запрашивалась после организации полным списком участников, и вкладка
      // «Участники» с кнопкой «Сохранить» появлялись на несколько секунд
      // позже остальной страницы.
      try {
        const [orgRes, activeMember] = await Promise.all([
          fetch(`/api/organization?userId=${encodeURIComponent(user.id)}`).then(
            (r) => r.json(),
          ),
          authClient.organization.getActiveMember(),
        ])
        const org: Organization | null = orgRes.organization ?? null
        let role: string | null = null
        if (org?.id && activeMember.data?.organizationId === org.id) {
          role = activeMember.data.role ?? null
        } else if (org?.id) {
          // Активная организация сессии ≠ показываемой — редкий случай
          // (несколько организаций): берём роль из списка участников.
          const { data: members } = await authClient.organization.listMembers({
            query: { organizationId: org.id },
          })
          role =
            members?.members?.find(
              (m: { userId: string }) => m.userId === user.id,
            )?.role ?? null
        }
        setOrganization(org)
        setMemberRole(role)
      } catch (e) {
        console.error("Failed to fetch organization:", e)
      } finally {
        setLoaded(true)
      }
    }

    fetchOrganization()
  }, [user?.id])

  const initials = (name: string | null | undefined) =>
    name
      ? name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase()
      : "О"

  // Страница организации: заголовок — название организации, ниже две
  // вкладки («Информация об организации» / «Участники»). Данные пользователя
  // переехали на отдельную страницу профиля (/profile).
  if (!loaded || !organization) {
    // Как на «Правилах»/«Настройках»: лоадер на всю высоту страницы — иначе
    // в колонке без растяжения он прилипал к верху.
    return <PageLoader className="min-h-screen" />
  }

  const isOwner = memberRole === "owner"

  return (
    <div className="flex flex-col gap-4 p-4 min-h-screen">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="border border-border">
            <AvatarImage
              src={organization.logo ?? undefined}
              alt={organization.name ?? "Организация"}
            />
            <AvatarFallback>{initials(organization.name)}</AvatarFallback>
          </Avatar>
          <h1 className="truncate text-xl font-medium">{organization.name}</h1>
        </div>
        <PageHeaderActions />
      </div>

      <Tabs defaultValue="info" className="flex-1 gap-4">
        <TabsList>
          <TabsTrigger value="info">Информация об организации</TabsTrigger>
          {isOwner && user && (
            <TabsTrigger value="members">Участники</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="info" className="flex flex-col gap-4">
          <OrganizationInfoForm
            organization={organization}
            canEdit={isOwner}
            onSaved={(patch) =>
              setOrganization((prev) => (prev ? { ...prev, ...patch } : prev))
            }
          />

          {SHOW_PREVIEW_BILLING_BLOCKS && isOwner && (
            <>
              <Card className="w-full">
                <CardHeader className="flex flex-row items-center gap-6 justify-start">
                  <CardTitle className="text-xl font-medium">
                    Управление API-ключами — ТОЛЬКО ПРЕДПРОСМОТР
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <TableUserApiKeys />
                </CardContent>
              </Card>

              <Card className="w-full">
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

              <Card className="w-full">
                <CardHeader className="flex flex-row items-center gap-6 justify-start">
                  <CardTitle className="text-xl font-medium">
                    История покупок — ТОЛЬКО ПРЕДПРОСМОТР
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <TableUserOrders userId={userState?.id} />
                </CardContent>
              </Card>

              <Card className="w-full">
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
        </TabsContent>

        {isOwner && user && (
          <TabsContent value="members">
            <Card className="w-full">
              <CardContent>
                <TableOrgMembers
                  organizationId={organization.id}
                  currentUserId={user.id}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
