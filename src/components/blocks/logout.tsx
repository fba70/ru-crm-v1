"use client"

import { LogOut } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { useRouter } from "next/navigation"
import { SidebarMenuButton } from "@/components/ui/sidebar"

// SidebarMenuButton с классами ссылок меню — как у «Уведомлений»: пункт
// получает всю геометрию меню (w-full, h-8, сворачивание в size-8) из одного
// источника. Подпись всегда в DOM — в свёрнутом виде её срезает CSS.
// Рендерится напрямую в <SidebarMenuItem> (БЕЗ внешнего asChild-враппера).
export function Logout() {
  const router = useRouter()

  const handleLogout = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/sign-in")
        },
      },
    })
  }

  return (
    <SidebarMenuButton
      onClick={handleLogout}
      className="flex items-center p-2 rounded-md cursor-pointer text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground"
    >
      <LogOut className="size-4 mr-2 shrink-0" />
      <span className="text-sm">Выйти</span>
    </SidebarMenuButton>
  )
}
