"use client"

// Whether the global AI-chat slide-over panel is open — separate from
// `chat-panel-context.tsx`'s PanelContext, which tracks the DETAIL panel
// content the chat can show beside itself. Kept as its own tiny context
// (rather than folding into PanelContext) because it needs to be readable
// from every page's header trigger button while the actual panel JSX lives
// once at the (protected) layout level — see global-ai-chat.tsx.
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react"

interface GlobalChatContextValue {
  open: boolean
  openChat: () => void
  closeChat: () => void
}

const GlobalChatContext = createContext<GlobalChatContextValue | null>(null)

export function useGlobalChat() {
  const ctx = useContext(GlobalChatContext)
  if (!ctx) {
    throw new Error("useGlobalChat must be used within GlobalChatProvider")
  }
  return ctx
}

export function GlobalChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openChat = useCallback(() => setOpen(true), [])
  const closeChat = useCallback(() => setOpen(false), [])

  return (
    <GlobalChatContext.Provider value={{ open, openChat, closeChat }}>
      {children}
    </GlobalChatContext.Provider>
  )
}
