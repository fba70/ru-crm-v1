"use client"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Sparkles } from "lucide-react"
import type { DealRow } from "@/app/api/deals/route"
import type { Confidence } from "@/server/deals-mock"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "низкая",
  medium: "средняя",
  high: "высокая",
}

// Показывает происхождение последнего изменения сделки (reasoning/changes),
// если оно есть. Иначе ничего не рендерит.
//
// `source` и `confidence` — МОК (из /api/deals/intel). TODO(backend): источник
// изменения (ссылка на письмо/звонок/сообщение) и уверенность агента должны
// приходить структурно на самой сделке.
export function DealProvenance({
  deal,
  source = null,
  confidence = null,
}: {
  deal: DealRow
  source?: string | null
  confidence?: Confidence | null
}) {
  if (!deal.reasoning && !deal.changes) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          aria-label="Происхождение изменения"
        >
          <Badge
            variant="secondary"
            className="cursor-pointer bg-violet-500/15 text-violet-600 dark:text-violet-300 gap-1"
          >
            <Sparkles className="h-3 w-3" />
            происхождение
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Происхождение
        </div>
        {deal.changes && (
          <div>
            <div className="text-xs text-muted-foreground">Изменение</div>
            <div className="whitespace-pre-wrap">{deal.changes}</div>
          </div>
        )}
        {deal.reasoning && (
          <div>
            <div className="text-xs text-muted-foreground">Обоснование</div>
            <div className="whitespace-pre-wrap">{deal.reasoning}</div>
          </div>
        )}
        {source && (
          <div>
            <div className="text-xs text-muted-foreground">Источник</div>
            {/* TODO(backend): сделать кликабельной ссылкой на исходное
                письмо/звонок/сообщение, когда появится реальный источник. */}
            <div className="text-sky-600 dark:text-sky-400">{source}</div>
          </div>
        )}
        {confidence && (
          <div className="flex justify-between">
            <div className="text-xs text-muted-foreground">Уверенность</div>
            <div className="text-xs">{CONFIDENCE_LABEL[confidence]}</div>
          </div>
        )}
        <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t">
          <span>{deal.userName ?? "—"}</span>
          <span>{formatDate(deal.updatedAt)}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
