import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
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
    <SidebarProvider>
      <AppSidebar session={session} />

      <div className="flex-1 flex flex-col">
        <div className="absolute top-2 right-3">
          <SidebarTrigger />
        </div>

        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </SidebarProvider>
  )
}
