import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/blocks/app-sidebar"
import { getServerSession } from "@/lib/get-session"
import { redirect } from "next/navigation"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession()
  if (!session?.user) redirect("/sign-in")

  return (
    <SidebarProvider
      style={
        // Ширина сайдбара под содержимое: задаётся самым широким элементом —
        // слоганом «Операционная система продаж» под логотипом (в одну строку,
        // без переноса). Дефолта 11rem/14rem не хватало.
        { "--sidebar-width": "16rem" } as React.CSSProperties
      }
    >
      <AppSidebar session={session} />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </SidebarProvider>
  )
}
