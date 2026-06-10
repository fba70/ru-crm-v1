import { NextRequest, NextResponse } from "next/server"
import { listProducts, listProductCategories } from "@/server/products"

export {
  type ProductRow,
  type ProductStockLocation,
  type ListProductsResult,
} from "@/server/products"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

// GET /api/products?q=&category=&limit=&offset=
//   → { rows, total } — server-side paginated + searched listing. Returns
//     the current page + total-page count without pulling the whole (large)
//     catalog client-side.
// GET /api/products?categories=1
//   → { categories: string[] } — distinct category list for the filter.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    if (searchParams.get("categories") === "1") {
      const categories = await listProductCategories()
      return NextResponse.json({ categories })
    }

    const q = searchParams.get("q") ?? undefined
    const category = searchParams.get("category") ?? undefined
    const limitRaw = Number.parseInt(searchParams.get("limit") ?? "25", 10)
    const offsetRaw = Number.parseInt(searchParams.get("offset") ?? "0", 10)

    const result = await listProducts({
      q,
      category,
      limit: Number.isFinite(limitRaw) ? limitRaw : 25,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
