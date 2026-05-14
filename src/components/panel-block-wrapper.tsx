"use client"

import type { ReactNode } from "react"
import { MaximizeIcon } from "lucide-react"

interface PanelBlockWrapperProps {
  displayMode: "inline" | "panel"
  title?: string
  subtitle?: string
  onExpand?: () => void
  children: ReactNode
}

export function PanelBlockWrapper({
  displayMode,
  title,
  subtitle,
  onExpand,
  children,
}: PanelBlockWrapperProps) {
  if (displayMode === "inline") {
    return (
      <div className="space-y-2">
        {title && (
          <div>
            <h4 className="text-sm font-semibold">{title}</h4>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        )}
        {children}
      </div>
    )
  }

  return (
    <div
      className="rounded-lg border bg-card cursor-pointer hover:border-primary/50 transition-colors"
      onClick={onExpand}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div>
          <span className="text-xs font-medium">
            {title || "Interactive view"}
          </span>
          {subtitle && (
            <span className="text-xs text-muted-foreground ml-2">
              {subtitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <MaximizeIcon className="size-3" />
          <span>Expand</span>
        </div>
      </div>
      <div className="max-h-[300px] overflow-hidden relative p-3">
        {children}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-card to-transparent" />
      </div>
    </div>
  )
}
