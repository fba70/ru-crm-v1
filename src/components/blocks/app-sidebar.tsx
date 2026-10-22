"use client"

import {
  Home,
  ChartColumnBig,
  Settings2,
  Building2,
  PencilRuler,
  Database,
  Users,
  Contact,
  ListChecks,
  Package,
  SquareKanban,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Logout } from "./logout"
import { usePathname } from "next/navigation"
import { BrandMark } from "./brand-mark"
import Link from "next/link"
import type { getServerSession } from "@/lib/get-session"

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof getServerSession>>
>

export const items = [
  {
    title: "Домашняя",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Компании",
    url: "/clients",
    icon: Users,
  },
  {
    title: "Контакты",
    url: "/contacts",
    icon: Contact,
  },
  {
    title: "Сделки",
    url: "/deals",
    icon: SquareKanban,
  },
  {
    title: "Заказы",
    url: "/products",
    icon: Package,
  },
  {
    title: "Задачи",
    url: "/tasks",
    icon: ListChecks,
  },
  {
    title: "Аналитика",
    url: "/analytics",
    icon: ChartColumnBig,
  },
  {
    title: "Правила",
    url: "/rules",
    icon: PencilRuler,
  },
  {
    title: "Источники",
    url: "/sources",
    icon: Database,
  },
]

// Инициалы для аватарки без картинки: «Анна Соколова» → «АС».
function initialsOf(name: string | null | undefined, fallback: string) {
  if (!name) return fallback
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
  return letters || fallback
}

function footerLinkClass(active: boolean) {
  return `flex items-center p-2 rounded-md ${
    active
      ? "bg-gray-200 text-primary dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
      : "text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground"
  }`
}

export function AppSidebar({
  session,
  orgLogo = null,
}: {
  session: AuthSession
  // Loaded server-side (not from the session) because logos are large base64
  // data URLs that would overflow the session cookie. See (protected)/layout.tsx.
  orgLogo?: string | null
}) {
  const pathname = usePathname()

  const orgName = session.session.activeOrganizationName ?? null
  const userName = session.user.name
  const userImage = session.user.image
  const isAdmin = session.user.role === "admin"

  return (
    <Sidebar className="flex flex-col h-screen" collapsible="icon">
      <SidebarContent className="flex-1">
        <SidebarHeader>
          {/* ЕДИНОЕ дерево для обоих состояний (переключение — только CSS по
              group-data-[collapsible=icon]): ветвление по `open` размонтировало
              знак и он «дёргался» при анимации сворачивания. h-7 фиксирует
              высоту шапки (иначе 44px ↔ 40px и меню подпрыгивает). В свёрнутом
              виде подпись схлопывается в w-0, знак центрируется, а триггер
              становится оверлеем поверх знака и проявляется по ховеру. */}
          <div className="group/logo relative flex h-7 items-center gap-2 overflow-hidden pl-1">
            {/* НИКАКИХ классов, переключаемых по состоянию раскладки: pl-1
                даёт знаку x=12 → центр 24px, верный и в развёрнутом, и в
                свёрнутом (48px) виде — знак не двигается вовсе, подпись
                плавно срезается overflow-hidden вместе с анимацией ширины. */}
            <BrandMark className="size-6 rounded-xl shrink-0 transition-opacity group-data-[collapsible=icon]:group-hover/logo:opacity-0" />
            <span className="min-w-0 flex-1 truncate text-base font-medium">
              salesdaily
            </span>
            <SidebarTrigger
              aria-label="Свернуть или развернуть меню"
              className="shrink-0 cursor-pointer transition-opacity group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:inset-0 group-data-[collapsible=icon]:m-auto group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:group-hover/logo:opacity-100"
            />
          </div>
        </SidebarHeader>

        <SidebarGroup>
          <Separator className="mb-3 -mt-3" />
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link
                      href={item.url}
                      className={`flex items-center p-2 rounded-md ${
                        pathname === item.url
                          ? "bg-gray-200 text-primary dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
                          : "text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground"
                      }`}
                    >
                      {/* Явный size-4: единый размер с кнопками (Button сам
                          ужимает svg до 16px) — иначе иконки «гуляют». */}
                      <item.icon className="size-4 mr-2 shrink-0" />
                      <span className="text-sm">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Нижний блок — административные пункты: профиль пользователя,
          организация, настройки, выход. Тема и уведомления переехали в шапку
          страницы (PageHeaderActions), отдельный блок «организация +
          пользователь» в самом низу больше не нужен — эти пункты и есть они. */}
      <SidebarFooter className="mt-auto mb-1">
        <SidebarMenu>
          <Separator className="my-1" />

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/profile" className={footerLinkClass(pathname === "/profile")}>
                {/* size-5 при контент-боксе пункта 16px: -m-0.5 компенсирует
                    лишние 4px, чтобы аватарка стояла по центру и в свёрнутом
                    сайдбаре, а подпись — вровень с остальными пунктами.
                    Бордер — цвет разделителей и рамок карточек (border-border). */}
                <Avatar className="size-5 -m-0.5 mr-1.5 shrink-0 border border-border">
                  <AvatarImage src={userImage || undefined} alt={userName ?? "Пользователь"} />
                  <AvatarFallback className="text-[9px]">
                    {initialsOf(userName, "П")}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm truncate">{userName}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/account" className={footerLinkClass(pathname === "/account")}>
                {orgLogo ? (
                  <Avatar className="size-5 -m-0.5 mr-1.5 shrink-0 border border-border">
                    <AvatarImage src={orgLogo} alt={orgName ?? "Организация"} />
                    <AvatarFallback className="text-[9px]">
                      {initialsOf(orgName, "О")}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Building2 className="size-4 mr-2 shrink-0" />
                )}
                <span className="text-sm truncate">{orgName ?? "Организация"}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {isAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="/settings" className={footerLinkClass(pathname === "/settings")}>
                  <Settings2 className="size-4 mr-2 shrink-0" />
                  <span className="text-sm">Настройки</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          <SidebarMenuItem>
            <Logout />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
