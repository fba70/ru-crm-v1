import { NextResponse } from "next/server"
import { buildPriceListWorkbook } from "@/server/products-export"

// Building the workbook holds the whole active catalog in memory and writes
// ~70 sheets — give it headroom over the default.
export const maxDuration = 120

// GET /api/products/export → XLSX price list (one sheet per country) for the
// caller's active organization. No params — exports the whole active catalog.
export async function GET() {
  try {
    const { buffer, fileName } = await buildPriceListWorkbook()
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
