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
  useSidebar,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Logout } from "./logout"
import { ModeSwitcher } from "./mode-switcher"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { BrandMark } from "./brand-mark"
import { BrandLogo } from "./brand-logo"
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
    title: "Клиенты",
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
  const { open } = useSidebar()

  const orgName = session.session.activeOrganizationName ?? null
  const userName = session.user.name
  const userImage = session.user.image
  const isAdmin = session.user.role === "admin"

  return (
    <Sidebar className="flex flex-col h-screen" collapsible="icon">
      <SidebarContent className="flex-1">
        <SidebarHeader>
          {open ? (
            <div className="flex flex-row gap-3 items-center justify-between">
              <BrandLogo
                src="/sd-logo-long-title.svg"
                className="h-6 w-[126px] text-logo"
              />
              <SidebarTrigger aria-label="Свернуть меню" className="cursor-pointer" />
            </div>
          ) : (
            // Свёрнутое состояние: логотип, а при наведении на него проявляется
            // кнопка разворота меню (логотип уходит в прозрачность).
            <div className="group relative flex items-center justify-center">
              <BrandMark className="size-6 rounded-xl transition-opacity group-hover:opacity-0" />
              <SidebarTrigger
                aria-label="Развернуть меню"
                className="absolute cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
              />
            </div>
          )}
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
                          ? "bg-gray-200 dark:bg-gray-600 text-primary"
                          : "text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground"
                      }`}
                    >
                      <item.icon size={24} className="mr-2" />
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
                    ? "bg-gray-200 dark:bg-gray-600 text-primary"
                    : "text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground"
                }`}
              >
                <CircleUserRound size={24} className="mr-3 ml-1" />
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
                      ? "bg-gray-200 dark:bg-gray-600 text-primary"
                      : "text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <ShieldCheck size={24} className="mr-3 ml-1" />
                  <span className="text-sm">Настройки</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          <SidebarMenuItem>
            <NotificationsDrawer compact={!open} />
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <ModeSwitcher
                className={cn(
                  "flex items-center justify-start",
                  !open ? "ml-1" : "",
                )}
              />
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Logout />
            </SidebarMenuButton>
          </SidebarMenuItem>

          <Separator className="my-1" />
          <SidebarMenuItem className="p-1">
            {orgName ? (
              <div
                className={cn(
                  "flex items-center gap-3 pl-1",
                  !open && "justify-center rounded-full",
                )}
              >
                <Avatar className={cn("h-6 w-6", !open && "h-6 w-6")}>
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
                {open && (
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                    {orgName}
                  </span>
                )}
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
            <div
              className={cn(
                "flex items-center gap-3 pl-1",
                !open && "justify-center rounded-full",
              )}
            >
              <Avatar className={cn("h-6 w-6", !open && "h-6 w-6")}>
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
              {open && (
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                  {userName}
                </span>
              )}
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
