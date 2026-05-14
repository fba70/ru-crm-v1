"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PanelContent {
  spec: unknown
  messageId: string
  title?: string
}

interface PanelContextValue {
  isOpen: boolean
  content: PanelContent | null
  history: PanelContent[]
  openPanel: (content: PanelContent) => void
  closePanel: () => void
  goBack: () => void
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PanelContext = createContext<PanelContextValue | null>(null)

export function usePanelContext() {
  const ctx = useContext(PanelContext)
  if (!ctx)
    throw new Error("usePanelContext must be used within PanelProvider")
  return ctx
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<PanelContent | null>(null)
  const [history, setHistory] = useState<PanelContent[]>([])

  const openPanel = useCallback((newContent: PanelContent) => {
    setContent((prev) => {
      if (prev) setHistory((h) => [...h, prev])
      return newContent
    })
  }, [])

  const closePanel = useCallback(() => {
    setContent(null)
    setHistory([])
  }, [])

  const goBack = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1]
      if (prev) {
        setContent(prev)
        return h.slice(0, -1)
      }
      setContent(null)
      return []
    })
  }, [])

  return (
    <PanelContext.Provider
      value={{
        isOpen: content !== null,
        content,
        history,
        openPanel,
        closePanel,
        goBack,
      }}
    >
      {children}
    </PanelContext.Provider>
  )
}
