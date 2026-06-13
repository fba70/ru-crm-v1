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
          className="flex flex-row gap-5 items-center justify-center"
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
