"use client"

import {
  Home,
  ChartColumnBig,
  FileText,
  ShieldCheck,
  CircleUserRound,
  PencilRuler,
  Database,
  Users,
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
import { ModeSwitcher } from "./mode-switcher"
import { usePathname } from "next/navigation"
import { BrandMark } from "./brand-mark"
import Link from "next/link"
import { NotificationsDrawer } from "./notifications-drawer"
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

      <SidebarFooter className="mt-auto mb-1">
        <SidebarMenu>
          <Separator className="my-1" />

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link
                href={"/account"}
                className={`flex items-center p-2 rounded-md ${
                  pathname === "/account"
                    ? "bg-gray-200 text-primary dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
                    : "text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground"
                }`}
              >
                <CircleUserRound className="size-4 mr-2 shrink-0" />
                <span className="text-sm">Организация</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {isAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link
                  href={"/settings"}
                  className={`flex items-center p-2 rounded-md ${
                    pathname === "/settings"
                      ? "bg-gray-200 text-primary dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
                      : "text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <ShieldCheck className="size-4 mr-2 shrink-0" />
                  <span className="text-sm">Настройки</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          <SidebarMenuItem>
            <NotificationsDrawer />
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <ModeSwitcher />
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <Logout />
          </SidebarMenuItem>

          <Separator className="my-1" />
          <SidebarMenuItem className="p-1">
            {orgName ? (
              // Текст всегда в DOM: в свёрнутом сайдбаре его срезает
              // overflow-hidden (как у пунктов меню), а аватар центрируется
              // паддингом — React-условие по `open` дёргало строку при
              // анимации сворачивания.
              <div className="flex items-center gap-3 overflow-hidden">
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarImage
                    src={orgLogo ?? undefined}
                    alt={orgName ?? "Organization"}
                  />
                  <AvatarFallback>
                    {orgName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                  {orgName}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center p-2">
                <span className="text-sm text-gray-500 truncate">
                  No organization
                </span>
              </div>
            )}
          </SidebarMenuItem>

          <SidebarMenuItem className="p-1">
            <div className="flex items-center gap-3 overflow-hidden">
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarImage
                  src={userImage ?? undefined}
                  alt={userName ?? "User"}
                />
                <AvatarFallback>
                  {userName
                    ? userName
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                    : "U"}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                {userName}
              </span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
