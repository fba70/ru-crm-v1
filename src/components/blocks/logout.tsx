"use client"

import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { useRouter } from "next/navigation"
import { useSidebar } from "@/components/ui/sidebar"

export function Logout() {
  const router = useRouter()
  const { open } = useSidebar()

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
    <Button
      variant="ghost"
      className="w-full justify-start p-2 text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent dark:hover:text-sidebar-accent-foreground"
      onClick={handleLogout}
    >
      <LogOut size={24} className="mr-4 ml-0" />{" "}
      {open && <span className="text-sm">Выйти</span>}
    </Button>
  )
}
