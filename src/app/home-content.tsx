"use client"

import { useSyncExternalStore } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import ElectricBorder from "@/components/ui/electric-border/ElectricBorder"
import Image from "next/image"
import { useTheme } from "next-themes"

const subscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

export function HomeContent() {
  const { resolvedTheme } = useTheme()
  const mounted = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )
  const isDark = mounted && resolvedTheme === "dark"

  const borderColor = isDark ? "#7df9ff" : "#C46B00"
  const subtitleColor = isDark ? "text-gray-200" : "text-gray-600"

  return (
    <div className="flex flex-col gap-8 items-center justify-center h-screen px-5 text-center">
      <ElectricBorder
        color={borderColor}
        speed={0.75}
        chaos={0.1}
        borderRadius={16}
        style={{ borderRadius: 16 }}
        className=""
      >
        <div className="h-auto w-95 flex flex-col items-center justify-center p-4">
          <div className="flex flex-col p-12 pb-4 h-full items-center justify-center">
            <Image
              src="/TP_golden_nobg.png"
              alt="Logo"
              width={260}
              height={260}
              loading="eager"
            />
            <p className="text-6xl font-bold mt-4 bg-linear-to-r from-orange-500 via-pink-500 to-blue-400 bg-clip-text text-transparent">
              truffalo.ai
            </p>
          </div>

          <div className="flex flex-col p-12 pt-4 items-center justify-center">
            <p className={`${subtitleColor} text-2xl text-center`}>
              AI-native Business Operating System
            </p>
          </div>
        </div>
      </ElectricBorder>

      <div className="flex gap-6 justify-center mt-8">
        <Link href="/sign-in">
          <Button className="w-25">Sign In</Button>
        </Link>
        <Link href="/sign-up">
          <Button className="w-25" variant="outline">
            Sign Up
          </Button>
        </Link>
      </div>
    </div>
  )
}
