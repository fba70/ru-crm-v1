"use client"

import * as React from "react"

import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

export function ModeSwitcher({ className }: { className?: string }) {
  const { setTheme, resolvedTheme } = useTheme()

  const toggleTheme = React.useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }, [resolvedTheme, setTheme])

  return (
    <Button
      variant="ghost"
      className={`group/toggle size-8 px-0 ${className}`}
      onClick={toggleTheme}
    >
      <SunIcon className="block dark:hidden mr-1" />
      <MoonIcon className="hidden dark:block mr-1" />
      <span className="text-sm ml-2">Тема</span>
    </Button>
  )
}
