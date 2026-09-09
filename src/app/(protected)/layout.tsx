import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/blocks/app-sidebar"
import { getServerSession } from "@/lib/get-session"
import { db } from "@/db/drizzle"
import { organization } from "@/db/schema"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import { PanelProvider } from "@/lib/chat-panel-context"
import { GlobalChatProvider } from "@/lib/global-chat-context"
import { AiChatPanel } from "@/components/blocks/global-ai-chat"

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
    <SidebarProvider
      style={
        // Ширина развёрнутого сайдбара — впритык к контенту. НЕ используем
        // max-content: у shadcn пустой gap-спейсер (sidebar-gap) тогда даёт
        // ширину 0 и fixed-панель наезжает на контент — ширина ОБОИХ элементов
        // должна быть одним конкретным значением. 13rem покрывает самый широкий
        // элемент (шапка: лого 126px + триггер), заметно у́же прежних 16rem.
        { "--sidebar-width": "13rem" } as React.CSSProperties
      }
    >
      <AppSidebar session={session} orgLogo={orgLogo} />

      <div className="relative flex-1 flex flex-col min-w-0">
        {/* Атмосфера лендинга (сетка + свечения, globals.css) — фон всего
            продукта. Лежит на колонке контента ВНЕ скролла, поэтому при
            прокрутке страниц неподвижна, как fixed .sd-bg на лендинге. */}
        <div className="sd-atmosphere" aria-hidden />
        <div className="relative z-[1] flex-1 overflow-auto">
          {/* ИИ-чат — общий для всего продукта, поднят из /dashboard сюда,
              чтобы кнопка "ИИ чат" (рядом с глобальным поиском) была
              доступна с любой страницы. Панель всегда смонтирована здесь и
              переживает переходы между страницами, поэтому история
              переписки не сбрасывается. */}
          <PanelProvider>
            <GlobalChatProvider>
              {children}
              <AiChatPanel />
            </GlobalChatProvider>
          </PanelProvider>
        </div>
      </div>
    </SidebarProvider>
  )
}
