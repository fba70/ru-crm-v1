"use client"

import { useSyncExternalStore } from "react"
import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"

// Переключатель темы в шапке страницы (раньше — пункт «Тема» в сайдбаре).
// Тот же сегментед-контрол, что переключатель «карточки / список» на
// Компаниях: стандартный TabsList без переопределений высоты, иконки h-4 и
// подсказки через AnchorTooltip (Radix Tooltip вокруг TabsTrigger ломает его
// размеры — см. src/app/CLAUDE.md § «White toolbar convention»).
//
// До монтирования тема на клиенте ещё не известна (next-themes читает её из
// localStorage), поэтому активный сегмент подсвечиваем только после
// гидратации — иначе серверная и клиентская разметка расходятся.
const noopSubscribe = () => () => {}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
  const lightTip = useAnchorTooltip()
  const darkTip = useAnchorTooltip()

  return (
    <>
      <Tabs
        value={mounted ? (resolvedTheme ?? "light") : ""}
        onValueChange={setTheme}
      >
        <TabsList aria-label="Тема оформления">
          <TabsTrigger value="light" aria-label="Светлая тема" {...lightTip.bind}>
            <SunIcon className="h-4 w-4" />
          </TabsTrigger>
          <TabsTrigger value="dark" aria-label="Тёмная тема" {...darkTip.bind}>
            <MoonIcon className="h-4 w-4" />
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <AnchorTooltip text="светлая тема" open={lightTip.open} virtualRef={lightTip.virtualRef} />
      <AnchorTooltip text="тёмная тема" open={darkTip.open} virtualRef={darkTip.virtualRef} />
    </>
  )
}
