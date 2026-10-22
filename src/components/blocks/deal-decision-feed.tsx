"use client"

import { Fragment } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Sparkles, User } from "lucide-react"
import type { FeedEvent } from "@/server/deals"
import { groupByDate } from "@/lib/date-groups"

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

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {events.length === 0 ? (
            <div className="text-sm text-muted-foreground">Пока нет событий.</div>
          ) : (
            groupByDate(events, (ev) => ev.at).map((group) => (
              <div key={group.label} className="space-y-3">
                {/* «Человеческая» дата-группа (UX №16). */}
                <div className="sticky top-0 -mt-1 bg-background/95 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {group.label}
                </div>
                {group.items.map((ev) => (
                  // Каждая запись — карточка (UX №16), агент/человек различаются
                  // цветом левой границы+фона и иконкой (UX №15): агент —
                  // фиолетовый (Sparkles), человек — нейтральный (User).
                  <div
                    key={ev.id}
                    className={`rounded-lg border p-2.5 text-sm ${
                      ev.isAI
                        ? "border-violet-500/50 bg-violet-500/5"
                        : "bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {ev.isAI ? (
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
                      ) : (
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span
                        className={
                          ev.isAI
                            ? "font-medium text-violet-600 dark:text-violet-300"
                            : "font-medium text-foreground"
                        }
                      >
                        {ev.actor}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatTime(ev.at)}
                      </span>
                    </div>
                    <div className="pt-1 text-muted-foreground">
                      {renderEventText(ev.text, ev.dealName)}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
