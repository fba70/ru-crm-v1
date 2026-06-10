"use server"

import { db } from "@/db/drizzle"
import { product, type EntityStatus } from "@/db/schema"
import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"

// One per-location stock entry (spreadsheet cols AB-AP).
export type ProductStockLocation = {
  key: string
  label: string
  count: number | null
}

export type ProductRow = {
  id: string
  name: string
  category: string | null
  webPageUrl: string | null
  // numeric(14,2) comes back from drizzle as a string; the API converts
  // to number for the client.
  price: number | null
  imageUrl: string | null
  totalStock: number | null
  accountingMetadata: Record<string, unknown>
  additionalMetadata: Record<string, unknown>
  stockMetadata: ProductStockLocation[]
  status: EntityStatus
  createdAt: string
  updatedAt: string
}

export type ListProductsParams = {
  q?: string
  category?: string
  limit?: number
  offset?: number
}

export type ListProductsResult = {
  rows: ProductRow[]
  total: number
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

// Server-side paginated + searched product listing. The catalog is large
// (tens of thousands of rows), so the page never pulls the full set —
// every fetch is one page with the current search applied in SQL.
//
// Search is intentionally broad-but-simple for now: a single ILIKE term
// OR'd across the main columns, the accounting codes, and the full
// additional-metadata blob cast to text (covers description / country /
// region / taste / etc.). Precision tuning is a deliberate later step.
export async function listProducts(
  params: ListProductsParams = {},
): Promise<ListProductsResult> {
  const { activeOrgId } = await requireOrgContext()

  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100)
  const offset = Math.max(params.offset ?? 0, 0)
  const q = params.q?.trim()
  const category = params.category?.trim()

  const where = and(
    eq(product.organizationId, activeOrgId),
    eq(product.status, "active"),
    category && category.length > 0
      ? eq(product.category, category)
      : undefined,
    q && q.length > 0
      ? or(
          ilike(product.name, `%${q}%`),
          ilike(product.category, `%${q}%`),
          sql`${product.accountingMetadata}::text ILIKE ${`%${q}%`}`,
          sql`${product.additionalMetadata}::text ILIKE ${`%${q}%`}`,
        )
      : undefined,
  )

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: product.id,
        name: product.name,
        category: product.category,
        webPageUrl: product.webPageUrl,
        price: product.price,
        imageUrl: product.imageUrl,
        totalStock: product.totalStock,
        accountingMetadata: product.accountingMetadata,
        additionalMetadata: product.additionalMetadata,
        stockMetadata: product.stockMetadata,
        status: product.status,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      })
      .from(product)
      .where(where)
      .orderBy(asc(product.name))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(product).where(where),
  ])

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      webPageUrl: r.webPageUrl,
      price: r.price === null ? null : Number(r.price),
      imageUrl: r.imageUrl,
      totalStock: r.totalStock,
      accountingMetadata:
        (r.accountingMetadata as Record<string, unknown> | null) ?? {},
      additionalMetadata:
        (r.additionalMetadata as Record<string, unknown> | null) ?? {},
      stockMetadata: Array.isArray(r.stockMetadata)
        ? (r.stockMetadata as ProductStockLocation[])
        : [],
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: totalRows[0]?.n ?? 0,
  }
}

// Distinct non-null categories for the active org's active products,
// alphabetically sorted — powers the category filter dropdown. Small
// cardinality (catalog sections), so a plain DISTINCT is fine.
export async function listProductCategories(): Promise<string[]> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await db
    .selectDistinct({ category: product.category })
    .from(product)
    .where(
      and(
        eq(product.organizationId, activeOrgId),
        eq(product.status, "active"),
      ),
    )
    .orderBy(asc(product.category))

  return rows
    .map((r) => r.category)
    .filter((c): c is string => c !== null && c.trim().length > 0)
}
