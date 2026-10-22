"use client"

import { AiChatTrigger } from "@/components/blocks/global-ai-chat"
import { GlobalSearch } from "@/components/blocks/global-search"
import { ThemeToggle } from "@/components/blocks/theme-toggle"
import { NotificationsDrawer } from "@/components/blocks/notifications-drawer"

// Правая часть шапки каждой страницы, одна на всё приложение: ИИ-чат, поиск,
// переключатель темы и колокольчик уведомлений. Раньше этот набор кнопок
// копировался на каждую страницу — теперь меняется в одном месте.
export function PageHeaderActions() {
  return (
    <div className="flex items-center gap-2">
      <AiChatTrigger />
      <GlobalSearch />
      <ThemeToggle />
      <NotificationsDrawer />
    </div>
  )
}
