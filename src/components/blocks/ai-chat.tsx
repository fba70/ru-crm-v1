"use client"

import { useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  isToolUIPart,
  type FileUIPart,
  type UIMessage,
} from "ai"
import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  Component,
  type ReactNode,
} from "react"
import {
  CopyIcon,
  CheckIcon,
  DatabaseIcon,
  GlobeIcon,
  Save,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import {
  useJsonRenderMessage,
  Renderer,
  JSONUIProvider,
} from "@json-render/react"

import { registry } from "@/lib/registry"
import { usePanelContext } from "@/lib/chat-panel-context"
import { sanitizeSpec } from "@/lib/json-render-sanitize"

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInputProvider,
  PromptInput,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import { SpeechInput } from "@/components/ai-elements/speech-input"
import { Shimmer } from "@/components/ai-elements/shimmer"
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning"
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "@/components/ai-elements/sources"
import {
  ModelSelector,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorList,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorLogo,
  ModelSelectorName,
} from "@/components/ai-elements/model-selector"
import { SaveChatDialog } from "@/components/blocks/save-chat-dialog"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import Image from "next/image"
import { FoundSourcesCard } from "@/components/blocks/found-sources-card"
import {
  EntityCandidatesCard,
  type EntityType,
} from "@/components/blocks/entity-candidates-card"
import { MODELS } from "@/lib/llm-models"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Model list lives in src/lib/llm-models.ts so the chat picker, the
// Explore-sources dialog, and the /api/chat route share one source of truth.

const ACCEPTED_FILE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]

const ACCEPTED_EXTENSIONS = ".png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.json"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFileTypeSupported(mediaType: string): boolean {
  return ACCEPTED_FILE_TYPES.includes(mediaType)
}

function validateFiles(files: FileUIPart[]): FileUIPart[] {
  const valid: FileUIPart[] = []
  for (const file of files) {
    if (!isFileTypeSupported(file.mediaType)) {
      toast.error(
        `Неподдерживаемый тип файла: ${file.mediaType}. Поддерживаются: изображения, .txt, .md, .csv, .json`,
      )
      continue
    }
    valid.push(file)
  }
  return valid
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIChat({ className }: { className?: string }) {
  const [selectedModel, setSelectedModel] = useState(MODELS[1].key)
  const [enableSearch, setEnableSearch] = useState(true)
  // Internal-sources tool group (search + content fetch + panel render).
  // Mutually exclusive with `enableSearch` on Gemini — the built-in
  // google_search tool can't share a call with custom function tools.
  const [enableSources, setEnableSources] = useState(false)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)

  const currentModel = MODELS.find((m) => m.key === selectedModel) ?? MODELS[0]
  const searchAvailable = currentModel.provider === "google"

  // Stable transport that reads the latest model/search values at request time
  // via a ref — avoids recreating the transport on every state change.
  const bodyRef = useRef({ model: selectedModel, enableSearch, enableSources })
  useEffect(() => {
    bodyRef.current = { model: selectedModel, enableSearch, enableSources }
  }, [selectedModel, enableSearch, enableSources])

  // Ref is read inside the body() closure at request build time, not during render.
  /* eslint-disable react-hooks/refs */
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => bodyRef.current,
      }),
    [],
  )
  /* eslint-enable react-hooks/refs */

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport,
  })

  const isStreaming = status === "streaming"
  const isLoading = status === "submitted" || isStreaming

  // ---- Handlers ----

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const validFiles = validateFiles(message.files)
      await sendMessage({
        text: message.text,
        files: validFiles,
      })
    },
    [sendMessage],
  )

  // Fired when the user clicks an entity candidate card — sends a
  // follow-up message asking the assistant to summarize that entity from
  // its sources (drives the getXContent → getSourceItemContent → summary
  // step). Ignored while a response is in flight.
  const handleEntitySelect = useCallback(
    (prompt: string) => {
      if (status === "submitted" || status === "streaming") return
      sendMessage({ text: prompt })
    },
    [sendMessage, status],
  )

  const handleSpeechTranscription = useCallback(
    (text: string) => {
      sendMessage({ text })
    },
    [sendMessage],
  )

  const handleClear = useCallback(() => {
    setMessages([])
  }, [setMessages])

  const handleToggleSearch = useCallback(() => {
    setEnableSearch((prev) => {
      const next = !prev
      // Mutual exclusion: turning Search on flips Sources off (Gemini
      // can't run google_search with custom tools in the same call).
      if (next) setEnableSources(false)
      return next
    })
  }, [])

  const handleToggleSources = useCallback(() => {
    setEnableSources((prev) => {
      const next = !prev
      if (next) setEnableSearch(false)
      return next
    })
  }, [])

  // ---- Render ----

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-md border-2 border-gray-200 dark:border-gray-700 bg-card text-card-foreground",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="Logo"
            width={24}
            height={24}
            className="rounded-full"
          />
          <p className="text-sm font-medium flex flex-row items-center gap-1">
            <span className="bg-linear-to-r from-orange-500 via-pink-500 to-blue-400 bg-clip-text text-transparent">
              business OS
            </span>{" "}
            чат
          </p>
        </div>
        <div className="flex items-center gap-1">
          {/* Internal sources toggle (provider-agnostic). Always visible. */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={enableSources ? "default" : "ghost"}
                  size="icon-sm"
                  onClick={handleToggleSources}
                >
                  <DatabaseIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {enableSources ? "Выключить" : "Включить"} поиск по внутренним
                  источникам
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Web search toggle (Gemini only). */}
          {searchAvailable && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={enableSearch ? "default" : "ghost"}
                    size="icon-sm"
                    onClick={handleToggleSearch}
                  >
                    <GlobeIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{enableSearch ? "Выключить" : "Включить"} веб-поиск</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Model selector */}
          <ModelSelector
            open={modelSelectorOpen}
            onOpenChange={setModelSelectorOpen}
          >
            <ModelSelectorTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 text-xs">
                <ModelSelectorLogo
                  provider={currentModel.provider}
                  className="size-4"
                />
                {currentModel.label}
              </Button>
            </ModelSelectorTrigger>
            <ModelSelectorContent>
              <ModelSelectorInput placeholder="Поиск моделей..." />
              <ModelSelectorList>
                <ModelSelectorGroup heading="Доступные модели">
                  {MODELS.map((model) => (
                    <ModelSelectorItem
                      key={model.key}
                      value={model.key}
                      onSelect={() => {
                        setSelectedModel(model.key)
                        setModelSelectorOpen(false)
                        if (model.provider === "google") {
                          setEnableSearch(true)
                          setEnableSources(false)
                        } else {
                          setEnableSearch(false)
                        }
                      }}
                    >
                      <ModelSelectorLogo
                        provider={model.provider}
                        className="size-4"
                      />
                      <ModelSelectorName>{model.label}</ModelSelectorName>
                    </ModelSelectorItem>
                  ))}
                </ModelSelectorGroup>
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>

          {/* Clear conversation */}
          {messages.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleClear}
                    disabled={isLoading}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Очистить переписку</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Save chat to sources — last button in the row, only when
              there's something to save. */}
          {messages.length > 0 && (
            <SaveChatDialog
              messages={messages}
              onSaved={() => {
                // No client-side cleanup needed — we deliberately don't
                // clear the chat after save (per Q2: non-destructive).
              }}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isLoading}
                  className="gap-1"
                >
                  <Save className="size-4" />
                  Сохранить чат
                </Button>
              }
            />
          )}
        </div>
      </div>

      {/* Messages area */}
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Поговорите с ассистентом business OS!"
              description="Спрашивайте о чём угодно — я отвечу на вопросы, помогу с анализом данных и не только."
              icon={
                <Image
                  src="/logo.png"
                  alt="Logo"
                  width={36}
                  height={36}
                  className="rounded-full"
                />
              }
            />
          ) : (
            messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={isStreaming}
                isBusy={isLoading}
                onEntitySelect={handleEntitySelect}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input area */}
      <div className="border-t p-4">
        <PromptInputProvider>
          <PromptInput
            onSubmit={handleSubmit}
            accept={ACCEPTED_EXTENSIONS}
            maxFileSize={MAX_FILE_SIZE}
            onError={(err) => toast.error(err.message)}
          >
            <PromptInputTextarea placeholder="Введите сообщение..." />
            <PromptInputTools className="pr-3 flex flex-row gap-2">
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              <SpeechInput
                size="icon-sm"
                variant="ghost"
                onTranscriptionChange={handleSpeechTranscription}
              />
              <PromptInputSubmit status={status} onStop={stop} />
            </PromptInputTools>
          </PromptInput>
        </PromptInputProvider>

        <p className="mt-3 px-6 text-xs leading-snug text-muted-foreground text-center">
          AI-чат business OS использует большие языковые модели для агентного
          поиска и рассуждений. Эти модели могут ошибаться или давать неверные
          рекомендации. <br /> Если информация важна для ваших бизнес-процессов
          или решений, рекомендуем перепроверять её по другим источникам.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message renderer
// ---------------------------------------------------------------------------

function ChatMessage({
  message,
  isStreaming,
  isBusy,
  onEntitySelect,
}: {
  message: UIMessage
  isStreaming: boolean
  isBusy: boolean
  onEntitySelect: (prompt: string) => void
}) {
  const isAssistant = message.role === "assistant"
  const isLastAssistant = isAssistant && isStreaming

  // json-render: extract spec from message parts
  const { spec, hasSpec } = useJsonRenderMessage(message.parts)
  const { openPanel } = usePanelContext()

  // Show a "Thinking..." shimmer while the assistant is streaming but
  // hasn't produced any visible content yet (text, reasoning, tool, file).
  // Reasoning parts only count when they actually have visible text — some
  // providers (notably OpenAI via the Responses API on the AI Gateway) emit
  // reasoning-start/end with encrypted content and no readable delta.
  const hasVisibleContent = message.parts.some(
    (p) =>
      (p.type === "text" && p.text) ||
      (p.type === "reasoning" && p.text) ||
      p.type === "file" ||
      isToolUIPart(p),
  )
  const showThinking = isLastAssistant && !hasVisibleContent && !hasSpec

  // Collect sources from parts
  const sources = message.parts.filter(
    (part): part is Extract<typeof part, { type: "source-url" }> =>
      part.type === "source-url",
  )

  return (
    <Message from={message.role}>
      <MessageContent className={hasSpec ? "w-full max-w-full" : undefined}>
        {showThinking && (
          <Shimmer duration={1} className="text-sm">
            Думаю...
          </Shimmer>
        )}
        {message.parts.map((part, index) => {
          const key = `${message.id}-${index}`

          switch (part.type) {
            case "text":
              if (!part.text) return null
              return isAssistant ? (
                <MessageResponse key={key} isAnimating={isLastAssistant}>
                  {part.text}
                </MessageResponse>
              ) : (
                <p key={key} className="whitespace-pre-wrap">
                  {part.text}
                </p>
              )

            case "reasoning":
              // Skip encrypted-only reasoning (OpenAI Responses API via gateway
              // emits reasoning chunks with no readable text — rendering an
              // empty Reasoning block visually obscures the actual answer).
              if (!part.text) return null
              return (
                <Reasoning key={key} isStreaming={isLastAssistant}>
                  <ReasoningTrigger />
                  <ReasoningContent>{part.text}</ReasoningContent>
                </Reasoning>
              )

            case "file":
              if (part.mediaType?.startsWith("image/")) {
                return (
                  <div key={key} className="relative max-w-sm">
                    <Image
                      src={part.url}
                      alt="Generated"
                      width={512}
                      height={512}
                      className="rounded-lg"
                      unoptimized
                    />
                  </div>
                )
              }
              return null

            default:
              // Handle tool parts generically
              if (isToolUIPart(part)) {
                const isDynamic = part.type === "dynamic-tool"
                const toolName = isDynamic
                  ? (part as { toolName: string }).toolName
                  : part.type.replace("tool-", "")

                // Custom rendering for the internal-source tools.
                //
                // `findClients` / `findContacts` / `findDeals` render as a
                // list of clickable entity-info cards — clicking one sends
                // a follow-up message that asks the assistant to summarize
                // that entity from its sources (it does NOT open a panel).
                //
                // `searchSourceItems` and the three `getXContent` tools all
                // return the same hit shape, so they share the "Found
                // Source(s)" card render (a card per source + per-card
                // Preview / Open-in-panel buttons).
                //
                // `getSourceItemContent` calls the model makes for grounding
                // are hidden entirely — content display is user-driven via
                // the source cards' buttons. Everything else (google_search,
                // future tools) falls through to the generic Tool render.
                const entityFindType: EntityType | null =
                  toolName === "findClients"
                    ? "client"
                    : toolName === "findContacts"
                      ? "contact"
                      : toolName === "findDeals"
                        ? "deal"
                        : null
                if (entityFindType) {
                  return (
                    <EntityCandidatesCard
                      key={key}
                      entityType={entityFindType}
                      state={part.state}
                      output={
                        part.state === "output-available"
                          ? (part as { output?: unknown }).output
                          : undefined
                      }
                      errorText={
                        part.state === "output-error"
                          ? (part as { errorText?: string }).errorText
                          : undefined
                      }
                      onSelect={onEntitySelect}
                      disabled={isBusy}
                    />
                  )
                }
                if (
                  toolName === "searchSourceItems" ||
                  toolName === "getClientContent" ||
                  toolName === "getContactContent" ||
                  toolName === "getDealContent"
                ) {
                  return (
                    <FoundSourcesCard
                      key={key}
                      state={part.state}
                      output={
                        part.state === "output-available"
                          ? (part as { output?: unknown }).output
                          : undefined
                      }
                      errorText={
                        part.state === "output-error"
                          ? (part as { errorText?: string }).errorText
                          : undefined
                      }
                    />
                  )
                }
                if (toolName === "getSourceItemContent") {
                  return null
                }

                return (
                  <Tool
                    key={key}
                    defaultOpen={part.state !== "output-available"}
                  >
                    {isDynamic ? (
                      <ToolHeader
                        type="dynamic-tool"
                        state={part.state}
                        toolName={toolName}
                        title={toolName}
                      />
                    ) : (
                      <ToolHeader
                        type={part.type as `tool-${string}`}
                        state={part.state}
                        title={toolName}
                      />
                    )}
                    <ToolContent>
                      {(part.state === "input-available" ||
                        part.state === "output-available") && (
                        <ToolInput
                          input={part.input as Record<string, unknown>}
                        />
                      )}
                      {part.state === "output-available" && (
                        <ToolOutput
                          output={part.output as Record<string, unknown>}
                          errorText={undefined}
                        />
                      )}
                      {part.state === "output-error" && (
                        <ToolOutput
                          output={undefined}
                          errorText={(part as { errorText?: string }).errorText}
                        />
                      )}
                    </ToolContent>
                  </Tool>
                )
              }
              return null
          }
        })}

        {/* Render json-render spec if present */}
        {hasSpec && spec && (
          <div
            className="w-full rounded-lg border bg-card cursor-pointer hover:border-primary/50 transition-colors mt-3"
            onClick={() =>
              openPanel({
                spec,
                messageId: message.id,
                title: "Подробности",
              })
            }
          >
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-xs font-medium text-muted-foreground">
                Интерактивный вид
              </span>
              <span className="text-xs text-muted-foreground">
                Нажмите, чтобы развернуть ↗
              </span>
            </div>
            <InlinePreview spec={spec} loading={isLastAssistant} />
          </div>
        )}

        {/* Render sources from Google search grounding */}
        {sources.length > 0 && (
          <Sources>
            <SourcesTrigger count={sources.length} />
            <SourcesContent>
              {sources.map((source, i) => (
                <Source
                  key={`source-${i}`}
                  href={source.url}
                  title={source.title ?? new URL(source.url).hostname}
                />
              ))}
            </SourcesContent>
          </Sources>
        )}
      </MessageContent>

      {/* Message actions for assistant messages */}
      {isAssistant && !isLastAssistant && (
        <MessageActions>
          <CopyButton text={getMessageText(message)} />
        </MessageActions>
      )}
    </Message>
  )
}

// ---------------------------------------------------------------------------
// Inline preview (wraps Renderer and forces a resize tick after mount so
// Recharts' ResponsiveContainer measures its parent correctly)
// ---------------------------------------------------------------------------

function InlinePreview({
  spec,
  loading,
}: {
  spec: unknown
  loading?: boolean
}) {
  useEffect(() => {
    if (loading) return
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"))
    })
    return () => cancelAnimationFrame(raf)
  }, [spec, loading])

  const safeSpec = useMemo(() => sanitizeSpec(spec), [spec])

  return (
    <div className="w-full max-h-96 overflow-auto relative p-3">
      <RendererErrorBoundary>
        <JSONUIProvider
          registry={registry}
          initialState={
            (safeSpec as { state?: Record<string, unknown> })?.state ?? {}
          }
        >
          <Renderer
            spec={safeSpec as Parameters<typeof Renderer>[0]["spec"]}
            registry={registry}
            loading={loading}
          />
        </JSONUIProvider>
      </RendererErrorBoundary>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// Error boundary to catch json-render rendering failures
class RendererErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <p className="text-xs text-muted-foreground italic py-2">
          Не удалось отобразить структурированный контент.
        </p>
      )
    }
    return this.props.children
  }
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <MessageAction tooltip="Копировать" onClick={handleCopy}>
      {copied ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </MessageAction>
  )
}
