import { NextRequest, NextResponse } from "next/server"
import {
  listProducts,
  listProductCategories,
  listProductFilterOptions,
  type ProductInStock,
} from "@/server/products"

export {
  type ProductRow,
  type ProductStockLocation,
  type ListProductsResult,
  type ProductFilterOptions,
} from "@/server/products"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

// GET /api/products?q=&category=&type=&color=&sugar=&year=&aging=
//       &bottleVolume=&countryName=&appelacion=&rating=&awards=
//       &priceMin=&priceMax=&inStock=&limit=&offset=
//   → { rows, total } — server-side paginated + searched + filtered listing.
//     Every filter runs in SQL over the whole catalog, not the fetched page.
// GET /api/products?categories=1   → { categories: string[] }
// GET /api/products?filterOptions=1 → { options: ProductFilterOptions }
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    if (searchParams.get("categories") === "1") {
      const categories = await listProductCategories()
      return NextResponse.json({ categories })
    }

    if (searchParams.get("filterOptions") === "1") {
      const options = await listProductFilterOptions()
      return NextResponse.json({ options })
    }

    // Empty-string params are treated as "not set".
    const str = (key: string) => {
      const v = searchParams.get(key)
      return v && v.trim().length > 0 ? v : undefined
    }
    const num = (key: string) => {
      const v = searchParams.get(key)
      if (v == null || v.trim() === "") return undefined
      const n = Number.parseFloat(v)
      return Number.isFinite(n) ? n : undefined
    }
    const inStockRaw = searchParams.get("inStock")
    const inStock: ProductInStock | undefined =
      inStockRaw === "in" || inStockRaw === "out" ? inStockRaw : undefined

    const limitRaw = Number.parseInt(searchParams.get("limit") ?? "25", 10)
    const offsetRaw = Number.parseInt(searchParams.get("offset") ?? "0", 10)

    const result = await listProducts({
      q: str("q"),
      category: str("category"),
      type: str("type"),
      color: str("color"),
      sugar: str("sugar"),
      year: str("year"),
      aging: str("aging"),
      bottleVolume: str("bottleVolume"),
      countryName: str("countryName"),
      appelacion: str("appelacion"),
      rating: str("rating"),
      awards: str("awards"),
      priceMin: num("priceMin"),
      priceMax: num("priceMax"),
      inStock,
      limit: Number.isFinite(limitRaw) ? limitRaw : 25,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
