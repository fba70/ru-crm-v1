import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/blocks/app-sidebar"
import { getServerSession } from "@/lib/get-session"
import { db } from "@/db/drizzle"
import { organization } from "@/db/schema"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession()
  if (!session?.user) redirect("/sign-in")

  // The org logo is loaded here (server-side) rather than carried on the
  // session — it's a large base64 data URL and would overflow the session
  // cookie (431 Request Header Fields Too Large). See src/lib/auth.ts note.
  const orgId = session.session.activeOrganizationId
  let orgLogo: string | null = null
  if (orgId) {
    const rows = await db
      .select({ logo: organization.logo })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1)
    orgLogo = rows[0]?.logo ?? null
  }

  return (
    <SidebarProvider>
      <AppSidebar session={session} orgLogo={orgLogo} />

      <div className="flex-1 flex flex-col">
        <div className="absolute top-2 right-3">
          <SidebarTrigger />
        </div>

        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </SidebarProvider>
  )
}
