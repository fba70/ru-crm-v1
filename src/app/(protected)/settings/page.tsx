"use client"

import { authClient } from "@/lib/auth-client"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ShieldAlert, Loader } from "lucide-react"
import { TableAdminUsers } from "@/components/tables/table-admin-users"
import { TableAdminOrgs } from "@/components/tables/table-admin-orgs"
import { TableAdminSources } from "@/components/tables/table-admin-sources"
import { TableAdminTemplates } from "@/components/tables/table-admin-templates"

export default function SettingsPage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader className="animate-spin h-8 w-8 text-gray-900 dark:text-gray-100" />
      </div>
    )
  }

  if (session?.user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <ShieldAlert className="h-16 w-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-medium">Доступ запрещён</h1>
        <p className="text-gray-500 mt-2">
          У вас нет прав для доступа к этой странице.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">НАСТРОЙКИ СИСТЕМЫ</h1>

      <div className="w-full max-w-7xl px-4">
        <Tabs defaultValue="users" className="w-full">
          <TabsList>
            <TabsTrigger value="users">Пользователи</TabsTrigger>
            <TabsTrigger value="organizations">Организации</TabsTrigger>
            <TabsTrigger value="templates">Шаблоны</TabsTrigger>
            <TabsTrigger value="sources">Источники</TabsTrigger>
            <TabsTrigger value="settings">Настройки</TabsTrigger>
          </TabsList>

          <TabsContent
            value="users"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <TableAdminUsers />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="organizations"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <TableAdminOrgs />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="templates"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <TableAdminTemplates />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="sources"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <TableAdminSources />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="settings"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground text-center py-8">
                  Настроек платформы пока нет.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
