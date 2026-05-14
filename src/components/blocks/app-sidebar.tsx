"use client"

import {
  Home,
  FileText,
  ShieldCheck,
  CircleUserRound,
  PencilRuler,
  Database,
  Users,
  ListChecks,
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
  useSidebar,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Logout } from "./logout"
import { ModeSwitcher } from "./mode-switcher"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import Image from "next/image"
import Link from "next/link"
import { NotificationsDrawer } from "./notifications-drawer"
import type { getServerSession } from "@/lib/get-session"

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof getServerSession>>
>

export const items = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Clients",
    url: "/clients",
    icon: Users,
  },
  {
    title: "Tasks",
    url: "/tasks",
    icon: ListChecks,
  },
  {
    title: "Rules",
    url: "/rules",
    icon: PencilRuler,
  },
  {
    title: "Sources",
    url: "/sources",
    icon: Database,
  },
]

export function AppSidebar({ session }: { session: AuthSession }) {
  const pathname = usePathname()
  const { open } = useSidebar()

  const orgName = session.session.activeOrganizationName ?? null
  const orgLogo = session.session.activeOrganizationLogo ?? null
  const userName = session.user.name
  const userImage = session.user.image
  const isAdmin = session.user.role === "admin"

  return (
    <Sidebar className="flex flex-col h-screen" collapsible="icon">
      <SidebarContent className="flex-1">
        <SidebarHeader>
          {open ? (
            <div className="flex flex-row gap-3 items-center justify-center">
              <Image
                src="/TP_golden_icon_small.jpg"
                alt="Logo"
                width={28}
                height={28}
                className="mt-1 rounded-full"
              />
              <h1 className="text-xl font-bold bg-linear-to-r from-orange-500 via-pink-500 to-blue-400 bg-clip-text text-transparent">
                truffalo.ai
              </h1>
            </div>
          ) : (
            <Image
              src="/TP_golden_icon_small.jpg"
              alt="Logo"
              width={40}
              height={40}
              className="mt-1 rounded-full"
            />
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
                          ? "bg-gray-200 dark:bg-gray-600 text-orange-400"
                          : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-white"
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
                    ? "bg-gray-200 dark:bg-gray-600 text-orange-400"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-white"
                }`}
              >
                <CircleUserRound size={24} className="mr-3 ml-1" />
                <span className="text-sm">Account</span>
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
                      ? "bg-gray-200 dark:bg-gray-600 text-orange-400"
                      : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-white"
                  }`}
                >
                  <ShieldCheck size={24} className="mr-3 ml-1" />
                  <span className="text-sm">Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link
                href={"/docs"}
                className={`flex items-center p-2 rounded-md ${
                  pathname === "/docs"
                    ? "bg-gray-200 dark:bg-gray-600 text-orange-400"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-white"
                }`}
              >
                <FileText size={24} className="mr-3 ml-1" />
                <span className="text-sm">Documents</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

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
