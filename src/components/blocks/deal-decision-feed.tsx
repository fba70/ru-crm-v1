"use client"

import { Fragment } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Sparkles, User } from "lucide-react"
import type { FeedEvent } from "@/server/deals-mock"

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Рендер текста события: заменяем токен "{deal}" на жирное имя сделки.
// Если dealName == null — токен просто выбрасываем. Без dangerouslySetInnerHTML.
function renderEventText(text: string, dealName: string | null) {
  const parts = text.split("{deal}")
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && dealName && (
        <b className="font-semibold text-foreground">{dealName}</b>
      )}
    </Fragment>
  ))
}

export function DealDecisionFeed({
  open,
  onOpenChange,
  events,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  events: FeedEvent[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="p-4 pb-3 border-b">
          <SheetTitle>Лента решений</SheetTitle>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {events.length === 0 ? (
            <div className="text-sm text-muted-foreground">Пока нет событий.</div>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="text-sm">
                <div className="flex items-center gap-1.5">
                  {ev.isAI ? (
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
                  ) : (
                    <User className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                  <span
                    className={
                      ev.isAI
                        ? "font-medium text-violet-600 dark:text-violet-300"
                        : "font-medium text-primary"
                    }
                  >
                    {ev.actor}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatTime(ev.at)}
                  </span>
                </div>
                <div className="pt-0.5 text-muted-foreground">
                  {renderEventText(ev.text, ev.dealName)}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
