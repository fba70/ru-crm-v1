"use client"

import * as React from "react"

import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

// Обычный <button> с ТЕМИ ЖЕ классами, что у ссылок меню сайдбара
// («Организация» и пр.) — НЕ shadcn <Button>: его собственные размеры/gap
// конфликтовали с классами SidebarMenuButton и пункт «прыгал» при
// сворачивании. Рендерится только внутри <SidebarMenuButton asChild>.
export function ModeSwitcher({ className }: { className?: string }) {
  const { setTheme, resolvedTheme } = useTheme()

  const toggleTheme = React.useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }, [resolvedTheme, setTheme])

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`flex items-center p-2 rounded-md cursor-pointer text-gray-600 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground ${className ?? ""}`}
    >
      <SunIcon className="size-4 mr-2 shrink-0 block dark:hidden" />
      <MoonIcon className="size-4 mr-2 shrink-0 hidden dark:block" />
      <span className="text-sm">Тема</span>
    </button>
  )
}
