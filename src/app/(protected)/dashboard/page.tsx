"use client"

import { CardsFeedSection } from "@/components/blocks/cards-feed-section"
import { GlobalSearch } from "@/components/blocks/global-search"
import { AiChatTrigger } from "@/components/blocks/global-ai-chat"

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-4 p-4 pb-10 min-h-screen">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-medium">AI операционная система для бизнеса</h1>
        <div className="flex items-center gap-2">
          <AiChatTrigger />
          <GlobalSearch />
        </div>
      </div>

      <div className="w-full">
        <CardsFeedSection />
      </div>
    </div>
  )
}
