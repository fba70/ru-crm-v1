"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { METRIC_LABEL, type MetricKey } from "./analytics-charts"

/**
 * Switches which measure a chart draws. Deliberately a switch rather than a
 * second y-axis: plotting money and counts on one plot would invent a
 * correlation between two unrelated scales.
 */
export function MetricToggle({
  value,
  onChange,
  metrics = ["revenue", "orders", "units"],
}: {
  value: MetricKey
  onChange: (m: MetricKey) => void
  metrics?: MetricKey[]
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={value}
      onValueChange={(v) => v && onChange(v as MetricKey)}
      className="h-7"
    >
      {metrics.map((m) => (
        <ToggleGroupItem
          key={m}
          value={m}
          aria-label={METRIC_LABEL[m]}
          className="px-2 text-[11px]"
        >
          {METRIC_LABEL[m]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
