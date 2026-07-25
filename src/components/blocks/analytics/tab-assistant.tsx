"use client"

// «ИИ ассистент» — a deliberately narrow chat scoped to the analytics model.
//
// Not the dashboard's general-purpose `<AIChat>`: no file upload, no model
// picker, no source search, no json-render. One tool, one vocabulary — which is
// exactly why it answers reliably. The model writes the prose; every
// `queryAnalytics` result renders itself through <AnalyticsAnswerCard>, so the
// numbers on screen come from SQL, never from the model retyping them.

import { useCallback, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInputProvider,
  PromptInput,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, ChartColumnBig, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { SUGGESTION_CHIPS, type AnalyticsQueryResult } from "@/lib/analytics-semantic"
import { AnalyticsAnswerCard } from "./analytics-answer-card"

/** The tool output shape the route returns (compact fields + `__render`). */
type QueryToolOutput = { __render?: AnalyticsQueryResult }

export function TabAssistant() {
  const [error, setError] = useState<string | null>(null)

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/analytics/assistant" }),
    onError: (e) => {
      setError(e.message || "Не удалось получить ответ")
      toast.error("Ассистент недоступен", { description: e.message })
    },
  })

  const busy = status === "streaming" || status === "submitted"

  const ask = useCallback(
    (text: string) => {
      const value = text.trim()
      if (!value || busy) return
      setError(null)
      void sendMessage({ text: value })
    },
    [busy, sendMessage],
  )

  const onSubmit = useCallback(
    (message: PromptInputMessage) => {
      ask(message.text ?? "")
    },
    [ask],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground max-w-3xl text-xs">
          Задайте вопрос о продажах — ассистент посчитает по тем же правилам,
          что и вкладки выше: выручка по оформленным и подтверждённым заказам, с
          учётом скидки клиента.
        </p>
        {messages.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setMessages([])
              setError(null)
            }}
          >
            <Trash2 className="size-4" />
            Очистить
          </Button>
        ) : null}
      </div>

      <div className="bg-card flex h-[65vh] min-h-125 flex-col rounded-xl border">
        <Conversation className="flex-1">
          <ConversationContent className="gap-4">
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<ChartColumnBig className="size-8" />}
                title="Спросите про продажи"
                description="Например: «Кто лучший продавец за период?» или «Сравни on-trade и off-trade по месяцам»"
              />
            ) : (
              messages.map((m) => (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  isStreaming={busy && m.id === messages.at(-1)?.id}
                />
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {error ? (
          <Alert variant="destructive" className="mx-3 mb-2 w-auto">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-2 border-t p-3">
          {/* Chips are pure UI: each just sends its text. Tune the list in
              SUGGESTION_CHIPS (src/lib/analytics-semantic.ts). */}
          <Suggestions>
            {SUGGESTION_CHIPS.map((c) => (
              <Suggestion
                key={c.label}
                suggestion={c.prompt}
                onClick={ask}
                disabled={busy}
                className="text-xs"
              >
                {c.label}
              </Suggestion>
            ))}
          </Suggestions>

          <PromptInputProvider>
            <PromptInput onSubmit={onSubmit}>
              <PromptInputTextarea
                placeholder="Спросите про выручку, продавцов, клиентов или товары…"
                disabled={busy}
              />
              <PromptInputTools className="justify-end pr-3">
                <PromptInputSubmit status={status} />
              </PromptInputTools>
            </PromptInput>
          </PromptInputProvider>
        </div>
      </div>
    </div>
  )
}

function AssistantMessage({
  message,
  isStreaming,
}: {
  message: UIMessage
  isStreaming: boolean
}) {
  const isAssistant = message.role === "assistant"

  // Charts render AFTER the prose regardless of when the tool ran, so the
  // takeaway always reads first.
  const answers = message.parts
    .filter((p) => {
      if (!isToolUIPart(p)) return false
      const name =
        p.type === "dynamic-tool"
          ? (p as { toolName: string }).toolName
          : p.type.replace("tool-", "")
      return name === "queryAnalytics"
    })
    .map((p) => (p as { output?: QueryToolOutput }).output?.__render)
    .filter((r): r is AnalyticsQueryResult => Boolean(r))

  const hasText = message.parts.some((p) => p.type === "text" && p.text)
  const running = message.parts.some(
    (p) => isToolUIPart(p) && p.state !== "output-available",
  )

  return (
    <Message from={message.role}>
      <MessageContent className={answers.length ? "w-full max-w-full" : undefined}>
        {isAssistant && !hasText && isStreaming ? (
          <Shimmer duration={1} className="text-sm">
            {running ? "Считаю…" : "Думаю…"}
          </Shimmer>
        ) : null}

        {message.parts.map((part, i) =>
          part.type === "text" && part.text ? (
            isAssistant ? (
              <MessageResponse key={i} isAnimating={isStreaming}>
                {part.text}
              </MessageResponse>
            ) : (
              <p key={i} className="whitespace-pre-wrap">
                {part.text}
              </p>
            )
          ) : null,
        )}

        {answers.map((r, i) => (
          <AnalyticsAnswerCard key={i} result={r} />
        ))}
      </MessageContent>
    </Message>
  )
}
