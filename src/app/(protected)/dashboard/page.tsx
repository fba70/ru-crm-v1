"use client"

import { Component, type ReactNode } from "react"

import { AIChat } from "@/components/blocks/ai-chat"
import { PanelProvider, usePanelContext } from "@/lib/chat-panel-context"
import { Renderer, JSONUIProvider } from "@json-render/react"
import { registry } from "@/lib/registry"
import { sanitizeSpec } from "@/lib/json-render-sanitize"
import { XIcon, ArrowLeftIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { CodeHighlighter } from "@/components/code-highlighter"
import { CardsFeedSection } from "@/components/blocks/cards-feed-section"

export default function DashboardPage() {
  return (
    <PanelProvider>
      <DashboardContent />
    </PanelProvider>
  )
}

function DashboardContent() {
  const { isOpen, content, history, closePanel, goBack } = usePanelContext()

  const safeSpec = content?.spec ? sanitizeSpec(content.spec) : null

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">
        AI ОПЕРАЦИОННАЯ СИСТЕМА ДЛЯ БИЗНЕСА
      </h1>

      <div className="w-full max-w-7xl px-4">
        <CardsFeedSection />
      </div>

      {/* Chat + Detail Panel area */}
      <div className="w-full max-w-7xl h-[40vh] min-h-130 flex gap-4 px-4">
        {/* Chat column */}
        <div
          className={`flex-1 min-h-0 transition-all duration-300 ${
            isOpen ? "max-w-[50%]" : "max-w-7xl mx-auto w-full"
          }`}
        >
          <AIChat className="h-full" />
        </div>

        {/* Detail panel */}
        {isOpen && content && (
          <div className="w-[50%] min-h-0 flex flex-col rounded-md border-2 border-gray-200 dark:border-gray-700 bg-card">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <Button variant="ghost" size="icon-sm" onClick={goBack}>
                    <ArrowLeftIcon className="size-4" />
                  </Button>
                )}
                <h3 className="text-sm font-semibold">
                  {content.title || "Подробности"}
                </h3>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={closePanel}>
                <XIcon className="size-4" />
              </Button>
            </div>

            {/* Rendered / Source switch */}
            <Tabs
              defaultValue="rendered"
              className="flex-1 min-h-0 flex flex-col"
            >
              <div className="px-4 pt-3">
                <TabsList>
                  <TabsTrigger value="rendered">Просмотр</TabsTrigger>
                  <TabsTrigger value="source">Исходный код</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent
                value="rendered"
                className="flex-1 min-h-0 overflow-y-auto p-4"
              >
                <RendererErrorBoundary>
                  <JSONUIProvider
                    registry={registry}
                    initialState={
                      (safeSpec as { state?: Record<string, unknown> })
                        ?.state ?? {}
                    }
                  >
                    <Renderer
                      spec={safeSpec as Parameters<typeof Renderer>[0]["spec"]}
                      registry={registry}
                    />
                  </JSONUIProvider>
                </RendererErrorBoundary>
              </TabsContent>

              <TabsContent
                value="source"
                className="flex-1 min-h-0 overflow-y-auto p-4"
              >
                <CodeHighlighter
                  code={JSON.stringify(content.spec, null, 2)}
                  language="json"
                  showLineNumbers
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  )
}

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
        <p className="text-sm text-muted-foreground italic p-4">
          Не удалось отобразить структурированный контент.
        </p>
      )
    }
    return this.props.children
  }
}
