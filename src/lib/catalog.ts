// =============================================================================
// json-render Catalog Definition
// =============================================================================
// Defines every component the AI is allowed to generate.
// The AI produces JSON specs constrained to these schemas.
//
// Groups: Layout, Typography, Data Display, Charts, Interactive, Media
// =============================================================================

import { defineCatalog } from "@json-render/core"
import { schema } from "@json-render/react/schema"
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog"
import { z } from "zod"

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const DisplayMode = z
  .enum(["inline", "panel"])
  .default("inline")
  .describe(
    "Where to render: 'inline' stays in chat, 'panel' opens the detail panel. " +
      "Use 'panel' for large tables (>8 rows), complex charts, or full code files.",
  )

const ColumnDef = z.object({
  key: z.string().describe("Property key in the row data"),
  label: z.string().describe("Human-readable column header"),
  type: z
    .enum(["string", "number", "date", "currency", "boolean", "percentage"])
    .default("string"),
  align: z.enum(["left", "center", "right"]).optional(),
  width: z.number().optional().describe("Column width in pixels"),
})

const ChartDataPoint = z
  .record(z.string(), z.union([z.string(), z.number(), z.null()]))
  .describe("A single data point — keys correspond to xKey/yKey/series")

const ChartSeries = z.object({
  dataKey: z.string().describe("Key in the data to plot"),
  label: z.string().describe("Legend label"),
  color: z
    .string()
    .optional()
    .describe("CSS color or chart token like var(--chart-1)"),
})

// ---------------------------------------------------------------------------
// 1. LAYOUT
// ---------------------------------------------------------------------------

const layoutComponents = {
  Card: shadcnComponentDefinitions.Card,
  Stack: shadcnComponentDefinitions.Stack,

  Grid: {
    props: z.object({
      columns: z
        .number()
        .min(1)
        .max(6)
        .default(2)
        .describe("Number of columns at desktop width"),
      gap: z.enum(["sm", "md", "lg"]).default("md"),
    }),
    slots: ["default"],
    description:
      "Responsive grid layout. Collapses to 1 column on mobile. " +
      "Use for placing multiple cards, charts, or metrics side by side.",
  },

  TabGroup: {
    props: z.object({
      tabs: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
        }),
      ),
      defaultTab: z.string().optional(),
    }),
    slots: ["default"],
    description:
      "Tabbed container. Each child should have a 'tabId' prop matching a tab id.",
  },

  PanelBlock: {
    props: z.object({
      displayMode: DisplayMode,
      title: z.string().optional(),
      subtitle: z.string().optional(),
    }),
    slots: ["default"],
    description:
      "Wrapper that controls inline-vs-panel rendering. " +
      "Wrap any complex content in this to give users the option to expand it.",
  },
}

// ---------------------------------------------------------------------------
// 2. TYPOGRAPHY
// ---------------------------------------------------------------------------

const typographyComponents = {
  Heading: shadcnComponentDefinitions.Heading,

  Text: {
    props: z.object({
      content: z.string(),
      variant: z.enum(["body", "caption", "muted", "lead"]).default("body"),
    }),
    description: "Text block with semantic variants.",
  },

  Badge: {
    props: z.object({
      label: z.string(),
      variant: z
        .enum(["default", "success", "warning", "error", "info", "outline"])
        .default("default"),
    }),
    description: "Small status badge or tag.",
  },

  KeyValue: {
    props: z.object({
      items: z.array(
        z.object({
          label: z.string(),
          value: z.string(),
        }),
      ),
      layout: z.enum(["horizontal", "vertical", "grid"]).default("vertical"),
    }),
    description:
      "Key-value pair display. Prefer this over a table when there are <6 fields.",
  },

  Metric: {
    props: z.object({
      label: z.string(),
      value: z.string(),
      change: z.string().optional().describe("e.g. '+12%' or '-3.2%'"),
      trend: z.enum(["up", "down", "neutral"]).optional(),
      format: z.enum(["number", "currency", "percentage"]).optional(),
    }),
    description:
      "Single KPI / metric card. Use in a Grid for dashboard-style summaries.",
  },
}

// ---------------------------------------------------------------------------
// 3. DATA DISPLAY
// ---------------------------------------------------------------------------

const dataComponents = {
  DataTable: {
    props: z.object({
      title: z.string().optional(),
      columns: z.array(ColumnDef),
      rows: z.array(z.record(z.string(), z.unknown())),
      sortable: z.boolean().default(true),
      searchable: z.boolean().default(false),
      pageSize: z.number().default(10),
      displayMode: DisplayMode,
    }),
    description:
      "Interactive data table with sorting and optional search. " +
      "Use 'panel' displayMode for tables with more than 8 rows.",
  },

  JsonView: {
    props: z.object({
      data: z.unknown(),
      title: z.string().optional(),
      collapsed: z.number().default(2).describe("Depth to auto-collapse at"),
      displayMode: DisplayMode,
    }),
    description:
      "Collapsible JSON tree viewer. Use for API responses, config objects, " +
      "or any deeply nested data the user may want to explore.",
  },
}

// ---------------------------------------------------------------------------
// 4. CHARTS (backed by shadcn/ui Charts / Recharts)
// ---------------------------------------------------------------------------

const chartComponents = {
  BarChart: {
    props: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      data: z.array(ChartDataPoint),
      xKey: z.string().describe("Data key for the x-axis (categories)"),
      series: z.array(ChartSeries).min(1),
      orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
      stacked: z.boolean().default(false),
      displayMode: DisplayMode.default("panel"),
    }),
    description:
      "Bar chart for comparing categories. Use 'horizontal' when labels are long.",
  },

  LineChart: {
    props: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      data: z.array(ChartDataPoint),
      xKey: z.string().describe("Data key for x-axis (usually time)"),
      series: z.array(ChartSeries).min(1),
      curved: z.boolean().default(true),
      showDots: z.boolean().default(false),
      displayMode: DisplayMode.default("panel"),
    }),
    description:
      "Line chart for trends over time. Prefer over BarChart for temporal x-axis.",
  },

  AreaChart: {
    props: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      data: z.array(ChartDataPoint),
      xKey: z.string(),
      series: z.array(ChartSeries).min(1),
      stacked: z.boolean().default(false),
      gradient: z.boolean().default(true),
      displayMode: DisplayMode.default("panel"),
    }),
    description:
      "Area chart — like LineChart but with filled regions. Use 'stacked' for cumulative totals.",
  },

  PieChart: {
    props: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      data: z.array(
        z.object({
          name: z.string(),
          value: z.number(),
          color: z.string().optional(),
        }),
      ),
      donut: z.boolean().default(false),
      showLabels: z.boolean().default(true),
      displayMode: DisplayMode.default("panel"),
    }),
    description:
      "Pie/donut chart for proportions. Use only for 2-7 categories.",
  },

  ScatterChart: {
    props: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      data: z.array(ChartDataPoint),
      xKey: z.string(),
      yKey: z.string(),
      sizeKey: z.string().optional().describe("Key for bubble size"),
      displayMode: DisplayMode.default("panel"),
    }),
    description:
      "Scatter/bubble chart for correlation between two numeric variables.",
  },

  RadarChart: {
    props: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      data: z.array(ChartDataPoint),
      axisKey: z.string().describe("Key for the spoke labels"),
      series: z.array(ChartSeries).min(1),
      displayMode: DisplayMode.default("panel"),
    }),
    description:
      "Radar chart for multi-dimensional comparison (skill assessments, product attributes).",
  },
}

// ---------------------------------------------------------------------------
// 5. INTERACTIVE
// ---------------------------------------------------------------------------

const interactiveComponents = {
  Button: shadcnComponentDefinitions.Button,
  Input: shadcnComponentDefinitions.Input,

  FormGroup: {
    props: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      submitLabel: z.string().default("Submit"),
    }),
    slots: ["default"],
    description:
      "Groups multiple Input fields into a form. " +
      "Use when the AI needs structured data from the user.",
  },

  SelectMenu: {
    props: z.object({
      label: z.string(),
      options: z.array(
        z.object({
          value: z.string(),
          label: z.string(),
        }),
      ),
      placeholder: z.string().optional(),
      multiple: z.boolean().default(false),
    }),
    description: "Dropdown select or multi-select.",
  },
}

// ---------------------------------------------------------------------------
// 6. MEDIA
// ---------------------------------------------------------------------------

const mediaComponents = {
  Markdown: {
    props: z.object({
      content: z.string().describe("Markdown-formatted text content"),
      displayMode: DisplayMode,
    }),
    description:
      "Rich markdown renderer. Use for formatted long-form text with headings, " +
      "lists, links, inline code, tables, math, or mermaid diagrams.",
  },

  CodeBlock: {
    props: z.object({
      code: z.string(),
      language: z
        .string()
        .default("plaintext")
        .describe("Language identifier for syntax highlighting"),
      title: z.string().optional().describe("Filename or description"),
      showLineNumbers: z.boolean().default(false),
      highlightLines: z
        .array(z.number())
        .optional()
        .describe("Line numbers to highlight"),
      displayMode: DisplayMode,
    }),
    description:
      "Syntax-highlighted code block. Use 'panel' displayMode for >30 lines.",
  },

  FileCard: {
    props: z.object({
      filename: z.string(),
      fileType: z.enum([
        "pdf",
        "csv",
        "xlsx",
        "json",
        "image",
        "code",
        "document",
        "other",
      ]),
      size: z
        .string()
        .optional()
        .describe("Human-readable size, e.g. '2.4 MB'"),
      url: z.string().optional().describe("Download or preview URL"),
      preview: z
        .string()
        .optional()
        .describe("Short text preview of contents"),
    }),
    description:
      "File attachment card with icon, metadata, and download action.",
  },

  Image: {
    props: z.object({
      src: z.string(),
      alt: z.string(),
      caption: z.string().optional(),
      aspectRatio: z.enum(["auto", "16:9", "4:3", "1:1"]).default("auto"),
    }),
    description: "Inline image with optional caption.",
  },
}

// ---------------------------------------------------------------------------
// ACTIONS
// ---------------------------------------------------------------------------

const actions = {
  openPanel: {
    params: z.object({
      blockId: z.string().describe("ID of the block to open in the panel"),
    }),
    description: "Open a specific block in the detail panel.",
  },

  copyToClipboard: {
    params: z.object({
      content: z.string(),
    }),
    description: "Copy text content to the user's clipboard.",
  },

  navigate: {
    params: z.object({
      url: z.string(),
    }),
    description: "Navigate to an internal or external URL.",
  },
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------

export const catalog = defineCatalog(schema, {
  components: {
    ...layoutComponents,
    ...typographyComponents,
    ...dataComponents,
    ...chartComponents,
    ...interactiveComponents,
    ...mediaComponents,
  },
  actions,
})

export type AppCatalog = typeof catalog
