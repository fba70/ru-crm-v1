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
    <Button variant="ghost" onClick={handleLogout}>
      <LogOut size={24} className="mr-4 ml-0" />{" "}
      {open && <span className="text-sm">Выйти</span>}
    </Button>
  )
}
