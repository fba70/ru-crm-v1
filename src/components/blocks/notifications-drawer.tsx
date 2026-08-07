"use client"

import { useState } from "react"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { SidebarMenuButton } from "@/components/ui/sidebar"
import { Bell } from "lucide-react"

export function NotificationsDrawer() {
  const [open, setOpen] = useState(false)

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {/* SidebarMenuButton с классами ссылок меню — пункт идентичен
            «Организации»/«Теме»/«Выйти» и сворачивается тем же механизмом. */}
        <SidebarMenuButton
          className="flex items-center p-2 rounded-md cursor-pointer text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground"
          onClick={(e) => {
            e.currentTarget.blur()
          }}
        >
          {/* Подпись всегда в DOM — в свёрнутом виде её срезает CSS
              SidebarMenuButton, как у остальных пунктов (см. logout.tsx). */}
          <Bell className="size-4 mr-2 shrink-0" />
          <span className="text-sm">Уведомления</span>
        </SidebarMenuButton>
      </DrawerTrigger>
      <DrawerContent className="mx-auto w-full max-w-4xl">
        <div className="">
          <DrawerHeader>
            <DrawerTitle>Notifications</DrawerTitle>
            <DrawerDescription></DrawerDescription>
          </DrawerHeader>
          <div className="flex-1 py-4 px-8 space-y-4 overflow-y-auto">
            {/* Notification items would go here */}
            <p>No new notifications.</p>
          </div>
          <DrawerFooter className="flex items-center justify-center">
            <DrawerClose asChild>
              <Button variant="outline">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
