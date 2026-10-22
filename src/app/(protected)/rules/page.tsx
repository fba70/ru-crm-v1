"use client"

import { authClient } from "@/lib/auth-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TableRules } from "@/components/tables/table-rules"
import { GlobalSearch } from "@/components/blocks/global-search"
import { NotificationsDrawer } from "@/components/blocks/notifications-drawer"
import { AiChatTrigger } from "@/components/blocks/global-ai-chat"
import { PageLoader } from "@/components/blocks/page-loader"

export default function RulesPage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <PageLoader className="min-h-screen" />
    )
  }

  const isAdmin = session?.user?.role === "admin"

  return (
    <div className="flex flex-col gap-4 p-4 pb-10 min-h-screen">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-medium">Правила</h1>
        <div className="flex items-center gap-2">
          <AiChatTrigger />
          <GlobalSearch />
          <NotificationsDrawer />
        </div>
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl font-medium">Системные правила</CardTitle>
        </CardHeader>
        <CardContent>
          <TableRules
            ruleType="System"
            canEdit={isAdmin}
            showUserColumn={false}
            showOrgFilter={false}
            showOrgColumn={false}
          />
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl font-medium">Пользовательские правила</CardTitle>
        </CardHeader>
        <CardContent>
          <TableRules
            ruleType="Custom"
            canEdit
            showUserColumn
            showOrgFilter={false}
            showOrgColumn={false}
          />
        </CardContent>
      </Card>
    </div>
  )
}
