"use client"

import { useState, useCallback } from "react"
import { ChevronRight, ChevronDown, CopyIcon, CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface JsonViewerProps {
  data: unknown
  title?: string
  collapsed?: number
}

export function JsonViewer({ data, title, collapsed = 2 }: JsonViewerProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [data])

  return (
    <div className="rounded-md border bg-muted/30">
      {title && (
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h4 className="text-sm font-semibold">{title}</h4>
          <button
            onClick={handleCopy}
            className="text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
          </button>
        </div>
      )}
      <div className="p-3 font-mono text-xs overflow-auto max-h-[500px]">
        <JsonNode value={data} depth={0} collapseAfter={collapsed} />
      </div>
    </div>
  )
}

function JsonNode({
  value,
  depth,
  collapseAfter,
  keyName,
}: {
  value: unknown
  depth: number
  collapseAfter: number
  keyName?: string
}) {
  const [expanded, setExpanded] = useState(depth < collapseAfter)

  if (value === null) {
    return (
      <span>
        {keyName != null && (
          <span className="text-blue-600 dark:text-blue-400">
            &quot;{keyName}&quot;:{" "}
          </span>
        )}
        <span className="text-muted-foreground">null</span>
      </span>
    )
  }

  if (typeof value === "boolean") {
    return (
      <span>
        {keyName != null && (
          <span className="text-blue-600 dark:text-blue-400">
            &quot;{keyName}&quot;:{" "}
          </span>
        )}
        <span className="text-amber-600 dark:text-amber-400">
          {String(value)}
        </span>
      </span>
    )
  }

  if (typeof value === "number") {
    return (
      <span>
        {keyName != null && (
          <span className="text-blue-600 dark:text-blue-400">
            &quot;{keyName}&quot;:{" "}
          </span>
        )}
        <span className="text-emerald-600 dark:text-emerald-400">{value}</span>
      </span>
    )
  }

  if (typeof value === "string") {
    return (
      <span>
        {keyName != null && (
          <span className="text-blue-600 dark:text-blue-400">
            &quot;{keyName}&quot;:{" "}
          </span>
        )}
        <span className="text-orange-600 dark:text-orange-400">
          &quot;{value}&quot;
        </span>
      </span>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span>
          {keyName != null && (
            <span className="text-blue-600 dark:text-blue-400">
              &quot;{keyName}&quot;:{" "}
            </span>
          )}
          {"[]"}
        </span>
      )
    }

    return (
      <div>
        <span
          className="cursor-pointer select-none inline-flex items-center gap-0.5"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {keyName != null && (
            <span className="text-blue-600 dark:text-blue-400">
              &quot;{keyName}&quot;:{" "}
            </span>
          )}
          {expanded ? "[" : `[${value.length} items]`}
        </span>
        {expanded && (
          <div className={cn("ml-4 border-l border-border/50 pl-2")}>
            {value.map((item, i) => (
              <div key={i}>
                <JsonNode
                  value={item}
                  depth={depth + 1}
                  collapseAfter={collapseAfter}
                />
                {i < value.length - 1 && ","}
              </div>
            ))}
          </div>
        )}
        {expanded && "]"}
      </div>
    )
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      return (
        <span>
          {keyName != null && (
            <span className="text-blue-600 dark:text-blue-400">
              &quot;{keyName}&quot;:{" "}
            </span>
          )}
          {"{}"}
        </span>
      )
    }

    return (
      <div>
        <span
          className="cursor-pointer select-none inline-flex items-center gap-0.5"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {keyName != null && (
            <span className="text-blue-600 dark:text-blue-400">
              &quot;{keyName}&quot;:{" "}
            </span>
          )}
          {expanded ? "{" : `{${entries.length} keys}`}
        </span>
        {expanded && (
          <div className={cn("ml-4 border-l border-border/50 pl-2")}>
            {entries.map(([k, v], i) => (
              <div key={k}>
                <JsonNode
                  value={v}
                  keyName={k}
                  depth={depth + 1}
                  collapseAfter={collapseAfter}
                />
                {i < entries.length - 1 && ","}
              </div>
            ))}
          </div>
        )}
        {expanded && "}"}
      </div>
    )
  }

  return <span>{String(value)}</span>
}
