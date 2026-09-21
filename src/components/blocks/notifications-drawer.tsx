"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
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
import { Bell, Building2, User, Handshake, LayoutGrid, Loader } from "lucide-react"
import { cn } from "@/lib/utils"

type NotificationEvent = {
  id: string
  type: "client" | "contact" | "deal" | "card"
  title: string
  subtitle: string | null
  createdAt: string
  href: string
}

// Same entity ↔ icon language as <GlobalSearch/>'s result groups
// (Building2/User/Handshake/…) — one visual vocabulary for "what kind of
// record is this" across the app.
const TYPE_ICON: Record<NotificationEvent["type"], typeof Building2> = {
  client: Building2,
  contact: User,
  deal: Handshake,
  card: LayoutGrid,
}

const POLL_MS = 45_000
// Cap individual toasts per poll tick so a big batch (e.g. a bulk discovery
// run) reads as one line instead of flooding the corner of the screen.
const MAX_TOASTS_PER_TICK = 3

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return "только что"
  if (min < 60) return `${min} мин назад`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs} ч назад`
  const days = Math.floor(hrs / 24)
  return `${days} дн назад`
}

export function NotificationsDrawer() {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<NotificationEvent[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  // Ids already seen in a previous successful poll — lets us tell "new since
  // last tick" (toast-worthy) apart from "new since I last opened the bell"
  // (badge-worthy, but not itself a fresh toast every 45s).
  const knownIdsRef = useRef<Set<string> | null>(null)

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications")
      if (!res.ok) return
      const data: { events: NotificationEvent[]; unreadCount: number } = await res.json()
      setEvents(data.events)
      setUnreadCount(data.unreadCount)

      const previousIds = knownIdsRef.current
      const currentIds = new Set(data.events.map((e) => e.id))
      if (previousIds) {
        // Skip the very first poll after mount — that's the existing
        // backlog, not something that "just happened".
        const fresh = data.events.filter((e) => !previousIds.has(e.id))
        fresh.slice(0, MAX_TOASTS_PER_TICK).forEach((e) => {
          toast(e.title, {
            description: e.subtitle ?? undefined,
            action: {
              label: "Открыть",
              onClick: () => {
                window.location.href = e.href
              },
            },
          })
        })
        if (fresh.length > MAX_TOASTS_PER_TICK) {
          toast(`Ещё ${fresh.length - MAX_TOASTS_PER_TICK} новых событий`)
        }
      }
      knownIdsRef.current = currentIds
    } catch {
      // Silent — the bell is informational, not worth a toast of its own.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => clearInterval(t)
  }, [poll])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next && unreadCount > 0) {
      // Optimistic — clears the badge immediately instead of waiting on the
      // round trip.
      setUnreadCount(0)
      fetch("/api/notifications", { method: "POST" }).catch(() => {})
    }
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerTrigger asChild>
        {/* SidebarMenuButton с классами ссылок меню — пункт идентичен
            «Организации»/«Теме»/«Выйти» и сворачивается тем же механизмом. */}
        <SidebarMenuButton
          className="flex items-center p-2 rounded-md cursor-pointer text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground"
          onClick={(e) => {
            e.currentTarget.blur()
          }}
        >
          <span className="relative mr-2 shrink-0">
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#C1121F] px-0.5 text-[9px] font-semibold leading-none text-white"
                aria-label={`${unreadCount} новых событий`}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </span>
          {/* Подпись всегда в DOM — в свёрнутом виде её срезает CSS
              SidebarMenuButton, как у остальных пунктов (см. logout.tsx). */}
          <span className="text-sm">Уведомления</span>
        </SidebarMenuButton>
      </DrawerTrigger>
      <DrawerContent className="mx-auto w-full max-w-lg">
        <div className="flex flex-col min-h-0">
          <DrawerHeader>
            <DrawerTitle>Уведомления</DrawerTitle>
            <DrawerDescription>
              Новые компании, контакты, сделки и карточки в организации.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 space-y-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader className="h-4 w-4 animate-spin" />
                Загрузка…
              </div>
            ) : events.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Пока нет уведомлений.
              </p>
            ) : (
              events.map((e) => {
                const Icon = TYPE_ICON[e.type]
                return (
                  <Link
                    key={e.id}
                    href={e.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-start gap-3 rounded-md p-2.5 text-sm transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{e.title}</div>
                      {e.subtitle && (
                        <div className="truncate text-xs text-muted-foreground">
                          {e.subtitle}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {timeAgo(e.createdAt)}
                    </span>
                  </Link>
                )
              })
            )}
          </div>
          <DrawerFooter className="flex items-center justify-center">
            <DrawerClose asChild>
              <Button variant="outline">Закрыть</Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
