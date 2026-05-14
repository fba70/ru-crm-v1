// =============================================================================
// Component Registry
// =============================================================================
// Maps each catalog entry to a real React component.
// Charts use shadcn/ui Chart components (Recharts under the hood).
// =============================================================================

"use client"

import { defineRegistry } from "@json-render/react"
import { shadcnComponents } from "@json-render/shadcn"
import { catalog } from "./catalog"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart"

import {
  Bar,
  BarChart as RechartsBarChart,
  Line,
  LineChart as RechartsLineChart,
  Area,
  AreaChart as RechartsAreaChart,
  Pie,
  PieChart as RechartsPieChart,
  Cell,
  Scatter,
  ScatterChart as RechartsScatterChart,
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"

import { Streamdown } from "streamdown"

import { DataTableComponent } from "@/components/data-table"
import { JsonViewer } from "@/components/json-viewer"
import { CodeHighlighter } from "@/components/code-highlighter"
import { PanelBlockWrapper } from "@/components/panel-block-wrapper"

// ---------------------------------------------------------------------------
// Helper: convert series array to ChartConfig
// ---------------------------------------------------------------------------
function buildChartConfig(
  series: Array<{ dataKey: string; label: string; color?: string }>,
): ChartConfig {
  const config: ChartConfig = {}
  series.forEach((s, i) => {
    config[s.dataKey] = {
      label: s.label,
      color: s.color || `var(--chart-${i + 1})`,
    }
  })
  return config
}

// ---------------------------------------------------------------------------
// Chart title block (reused across all chart types)
// ---------------------------------------------------------------------------
function ChartTitle({
  title,
  description,
}: {
  title?: string
  description?: string
}) {
  if (!title) return null
  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Registry definition
// ---------------------------------------------------------------------------

export const { registry } = defineRegistry(catalog, {
  components: {
    // --- Layout ---
    Card: shadcnComponents.Card,
    Stack: shadcnComponents.Stack,

    Grid: ({ props, children }) => (
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`,
        }}
      >
        {children}
      </div>
    ),

    TabGroup: ({ props, children }) => (
      <div className="space-y-4">
        <div className="flex gap-1 border-b">
          {props.tabs.map((tab) => (
            <button
              key={tab.id}
              className="px-4 py-2 text-sm font-medium border-b-2 border-transparent hover:border-foreground/30"
            >
              {tab.label}
            </button>
          ))}
        </div>
        {children}
      </div>
    ),

    PanelBlock: ({ props, children, emit }) => (
      <PanelBlockWrapper
        displayMode={props.displayMode}
        title={props.title}
        subtitle={props.subtitle}
        onExpand={() => emit("press")}
      >
        {children}
      </PanelBlockWrapper>
    ),

    // --- Typography ---
    Heading: shadcnComponents.Heading,

    Text: ({ props }) => {
      const variants: Record<string, string> = {
        body: "text-sm text-foreground",
        caption: "text-xs text-muted-foreground",
        muted: "text-sm text-muted-foreground",
        lead: "text-lg text-foreground font-medium",
      }
      return <p className={variants[props.variant]}>{props.content}</p>
    },

    Badge: ({ props }) => {
      const variants: Record<string, string> = {
        default: "bg-primary/10 text-primary",
        success: "bg-emerald-500/10 text-emerald-600",
        warning: "bg-amber-500/10 text-amber-600",
        error: "bg-red-500/10 text-red-600",
        info: "bg-blue-500/10 text-blue-600",
        outline: "border border-border text-foreground",
      }
      return (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variants[props.variant]}`}
        >
          {props.label}
        </span>
      )
    },

    KeyValue: ({ props }) => {
      const layoutClass: Record<string, string> = {
        horizontal: "flex flex-wrap gap-x-6 gap-y-1",
        vertical: "space-y-2",
        grid: "grid grid-cols-2 gap-x-4 gap-y-2",
      }
      return (
        <dl className={layoutClass[props.layout]}>
          {props.items.map((item) => (
            <div key={item.label} className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="text-sm font-medium">{item.value}</dd>
            </div>
          ))}
        </dl>
      )
    },

    Metric: ({ props }) => {
      const trendColor: Record<string, string> = {
        up: "text-emerald-600",
        down: "text-red-600",
        neutral: "text-muted-foreground",
      }
      return (
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-xs text-muted-foreground">{props.label}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight">
              {props.value}
            </span>
            {props.change && (
              <span
                className={`text-xs font-medium ${trendColor[props.trend || "neutral"]}`}
              >
                {props.change}
              </span>
            )}
          </div>
        </div>
      )
    },

    // --- Data Display ---
    DataTable: ({ props }) => (
      <DataTableComponent
        title={props.title}
        columns={props.columns ?? []}
        rows={(props.rows as Record<string, unknown>[] | undefined) ?? []}
        sortable={props.sortable}
        searchable={props.searchable}
        pageSize={props.pageSize}
      />
    ),

    JsonView: ({ props }) => (
      <JsonViewer
        data={props.data}
        title={props.title}
        collapsed={props.collapsed}
      />
    ),

    // --- Charts ---
    BarChart: ({ props }) => {
      const config = buildChartConfig(props.series)
      return (
        <div className="space-y-2">
          <ChartTitle title={props.title} description={props.description} />
          <ChartContainer config={config} className="min-h-[250px] w-full">
            <RechartsBarChart
              data={props.data}
              layout={
                props.orientation === "horizontal" ? "vertical" : "horizontal"
              }
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey={props.xKey}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {props.series.map((s) => (
                <Bar
                  key={s.dataKey}
                  dataKey={s.dataKey}
                  fill={`var(--color-${s.dataKey})`}
                  radius={[4, 4, 0, 0]}
                  stackId={props.stacked ? "stack" : undefined}
                />
              ))}
            </RechartsBarChart>
          </ChartContainer>
        </div>
      )
    },

    LineChart: ({ props }) => {
      const config = buildChartConfig(props.series)
      return (
        <div className="space-y-2">
          <ChartTitle title={props.title} description={props.description} />
          <ChartContainer config={config} className="min-h-[250px] w-full">
            <RechartsLineChart data={props.data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey={props.xKey}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {props.series.map((s) => (
                <Line
                  key={s.dataKey}
                  dataKey={s.dataKey}
                  type={props.curved ? "monotone" : "linear"}
                  stroke={`var(--color-${s.dataKey})`}
                  strokeWidth={2}
                  dot={props.showDots}
                />
              ))}
            </RechartsLineChart>
          </ChartContainer>
        </div>
      )
    },

    AreaChart: ({ props }) => {
      const config = buildChartConfig(props.series)
      return (
        <div className="space-y-2">
          <ChartTitle title={props.title} description={props.description} />
          <ChartContainer config={config} className="min-h-[250px] w-full">
            <RechartsAreaChart data={props.data}>
              {props.gradient && (
                <defs>
                  {props.series.map((s) => (
                    <linearGradient
                      key={s.dataKey}
                      id={`fill-${s.dataKey}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={`var(--color-${s.dataKey})`}
                        stopOpacity={0.8}
                      />
                      <stop
                        offset="95%"
                        stopColor={`var(--color-${s.dataKey})`}
                        stopOpacity={0.1}
                      />
                    </linearGradient>
                  ))}
                </defs>
              )}
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey={props.xKey}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {props.series.map((s) => (
                <Area
                  key={s.dataKey}
                  dataKey={s.dataKey}
                  type="monotone"
                  fill={
                    props.gradient
                      ? `url(#fill-${s.dataKey})`
                      : `var(--color-${s.dataKey})`
                  }
                  stroke={`var(--color-${s.dataKey})`}
                  stackId={props.stacked ? "stack" : undefined}
                />
              ))}
            </RechartsAreaChart>
          </ChartContainer>
        </div>
      )
    },

    PieChart: ({ props }) => {
      const config: ChartConfig = {}
      props.data.forEach((d, i) => {
        config[d.name] = {
          label: d.name,
          color: d.color || `var(--chart-${i + 1})`,
        }
      })
      return (
        <div className="space-y-2">
          <ChartTitle title={props.title} description={props.description} />
          <ChartContainer config={config} className="min-h-[250px] w-full">
            <RechartsPieChart>
              <ChartTooltip content={<ChartTooltipContent />} />
              <Pie
                data={props.data}
                dataKey="value"
                nameKey="name"
                innerRadius={props.donut ? "55%" : 0}
                label={props.showLabels}
              >
                {props.data.map((entry, i) => (
                  <Cell
                    key={entry.name}
                    fill={entry.color || `var(--chart-${i + 1})`}
                  />
                ))}
              </Pie>
              <ChartLegend content={<ChartLegendContent />} />
            </RechartsPieChart>
          </ChartContainer>
        </div>
      )
    },

    ScatterChart: ({ props }) => {
      const config: ChartConfig = {
        scatter: { label: props.title || "Data", color: "var(--chart-1)" },
      }
      return (
        <div className="space-y-2">
          <ChartTitle title={props.title} description={props.description} />
          <ChartContainer config={config} className="min-h-[250px] w-full">
            <RechartsScatterChart>
              <CartesianGrid />
              <XAxis dataKey={props.xKey} type="number" />
              <YAxis dataKey={props.yKey} type="number" />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Scatter data={props.data} fill="var(--color-scatter)" />
            </RechartsScatterChart>
          </ChartContainer>
        </div>
      )
    },

    RadarChart: ({ props }) => {
      const config = buildChartConfig(props.series)
      return (
        <div className="space-y-2">
          <ChartTitle title={props.title} description={props.description} />
          <ChartContainer config={config} className="min-h-[250px] w-full">
            <RechartsRadarChart data={props.data}>
              <PolarGrid />
              <PolarAngleAxis dataKey={props.axisKey} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {props.series.map((s) => (
                <Radar
                  key={s.dataKey}
                  dataKey={s.dataKey}
                  fill={`var(--color-${s.dataKey})`}
                  fillOpacity={0.3}
                  stroke={`var(--color-${s.dataKey})`}
                />
              ))}
              <ChartLegend content={<ChartLegendContent />} />
            </RechartsRadarChart>
          </ChartContainer>
        </div>
      )
    },

    // --- Interactive ---
    Button: shadcnComponents.Button,
    Input: shadcnComponents.Input,

    FormGroup: ({ props, children, emit }) => (
      <div className="space-y-4 rounded-lg border p-4">
        {props.title && (
          <div>
            <h4 className="text-sm font-semibold">{props.title}</h4>
            {props.description && (
              <p className="text-xs text-muted-foreground mt-1">
                {props.description}
              </p>
            )}
          </div>
        )}
        {children}
        <button
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => emit("press")}
        >
          {props.submitLabel}
        </button>
      </div>
    ),

    SelectMenu: ({ props, emit }) => (
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          {props.label}
        </label>
        <select
          className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm"
          onChange={() => emit("press")}
        >
          {props.placeholder && (
            <option value="" disabled>
              {props.placeholder}
            </option>
          )}
          {props.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    ),

    // --- Media ---
    Markdown: ({ props }) => (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <Streamdown>{props.content}</Streamdown>
      </div>
    ),

    CodeBlock: ({ props }) => (
      <CodeHighlighter
        code={props.code}
        language={props.language}
        title={props.title}
        showLineNumbers={props.showLineNumbers}
        highlightLines={props.highlightLines}
      />
    ),

    FileCard: ({ props }) => {
      const icons: Record<string, string> = {
        pdf: "\u{1F4C4}",
        csv: "\u{1F4CA}",
        xlsx: "\u{1F4CA}",
        json: "{ }",
        image: "\u{1F5BC}\uFE0F",
        code: "\u{1F4BB}",
        document: "\u{1F4DD}",
        other: "\u{1F4CE}",
      }
      return (
        <div className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50">
          <span className="text-xl">{icons[props.fileType]}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{props.filename}</p>
            {props.size && (
              <p className="text-xs text-muted-foreground">{props.size}</p>
            )}
          </div>
          {props.url && (
            <a
              href={props.url}
              download
              className="text-xs text-primary hover:underline"
            >
              Download
            </a>
          )}
        </div>
      )
    },

    Image: ({ props }) => {
      const ratioClass: Record<string, string> = {
        auto: "",
        "16:9": "aspect-video",
        "4:3": "aspect-[4/3]",
        "1:1": "aspect-square",
      }
      return (
        <figure className="space-y-1">
          {/* AI-emitted image: arbitrary remote URL with unknown dimensions —
              next/image needs known sizes and remotePatterns allowlists, so a
              plain <img> is the right tool here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={props.src}
            alt={props.alt}
            className={`rounded-lg object-cover w-full ${ratioClass[props.aspectRatio]}`}
          />
          {props.caption && (
            <figcaption className="text-xs text-muted-foreground text-center">
              {props.caption}
            </figcaption>
          )}
        </figure>
      )
    },
  },
  actions: {
    openPanel: async () => {
      // handled externally via panel context
    },
    copyToClipboard: async (params) => {
      if (params && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(params.content)
      }
    },
    navigate: async (params) => {
      if (params && typeof window !== "undefined") {
        window.location.href = params.url
      }
    },
  },
})
