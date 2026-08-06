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
import { Bell } from "lucide-react"
import { cn } from "@/lib/utils"

type NotificationsDrawerProps = {
  compact?: boolean
}

export function NotificationsDrawer({ compact }: NotificationsDrawerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            // В свёрнутом сайдбаре — квадрат как у остальных пунктов (они
            // получают size-8 от SidebarMenuButton, а этот триггер не обёрнут).
            compact ? "size-8 p-0 justify-center" : "w-full justify-start p-2",
            "text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent dark:hover:text-sidebar-accent-foreground",
          )}
          onClick={(e) => {
            e.currentTarget.blur()
          }}
        >
          <Bell /> {!compact && <span className="text-sm">Уведомления</span>}
        </Button>
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
