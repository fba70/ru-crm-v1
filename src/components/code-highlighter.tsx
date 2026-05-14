"use client"

import { useState, useCallback } from "react"
import { CopyIcon, CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface CodeHighlighterProps {
  code: string
  language?: string
  title?: string
  showLineNumbers?: boolean
  highlightLines?: number[]
}

export function CodeHighlighter({
  code,
  language = "plaintext",
  title,
  showLineNumbers = false,
  highlightLines,
}: CodeHighlighterProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  const lines = code.split("\n")
  const highlightSet = new Set(highlightLines)

  return (
    <div className="rounded-md border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          {title && (
            <span className="text-xs font-medium text-foreground">
              {title}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{language}</span>
        </div>
        <button
          onClick={handleCopy}
          className="text-muted-foreground hover:text-foreground p-1"
        >
          {copied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </button>
      </div>
      <div className="overflow-auto max-h-[500px]">
        <pre className="p-3 text-xs leading-relaxed">
          <code>
            {lines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "px-1 -mx-1",
                  highlightSet.has(i + 1) && "bg-primary/10 border-l-2 border-primary",
                )}
              >
                {showLineNumbers && (
                  <span className="inline-block w-8 text-right mr-3 text-muted-foreground select-none">
                    {i + 1}
                  </span>
                )}
                {line || " "}
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  )
}
