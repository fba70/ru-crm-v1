import { NextRequest, NextResponse } from "next/server"
import { buildPriceListWorkbook } from "@/server/products-export"

// Building the workbook holds the whole active catalog in memory and writes
// ~70 sheets — give it headroom over the default.
export const maxDuration = 120

// GET /api/products/export?countries=&regions=&colors= → XLSX price list (one
// sheet per country) for the caller's active organization. With no params it
// exports the whole active catalog; the comma-separated country / region /
// color params (the price-list hierarchy levels) narrow it to a subset. Filters
// on any OTHER catalog attribute are intentionally ignored by the export.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    // Repeated params (regions=A&regions=B), read via getAll — NOT comma-split,
    // since some region values legitimately contain commas.
    const list = (key: string) =>
      searchParams
        .getAll(key)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    const { buffer, fileName } = await buildPriceListWorkbook({
      countries: list("countries"),
      regions: list("regions"),
      colors: list("colors"),
    })
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    const status =
      message === "Unauthorized" || message === "No active organization"
        ? 403
        : 400
    return NextResponse.json({ error: message }, { status })
  }
}
