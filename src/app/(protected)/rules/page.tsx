"use client"

import { authClient } from "@/lib/auth-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader } from "lucide-react"
import { TableRules } from "@/components/tables/table-rules"

export default function RulesPage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader className="animate-spin h-8 w-8 text-gray-900 dark:text-gray-100" />
      </div>
    )
  }

  const isAdmin = session?.user?.role === "admin"

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">ПРАВИЛА</h1>

      <Card className="w-full max-w-7xl">
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

      <Card className="w-full max-w-7xl">
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
