import "server-only"

import ExcelJS from "exceljs"
import { and, asc, eq, sql } from "drizzle-orm"

import { db } from "@/db/drizzle"
import { product } from "@/db/schema"
import { getServerSession } from "@/lib/get-session"

// Price-list export — one XLSX workbook with ONE SHEET PER COUNTRY, each sheet
// a hierarchical price list grouped left→right region → color → vendor → name.
// Mirrors refs/price-list.xlsx. CSV is intentionally NOT offered: the format
// is inherently multi-tab (one tab per country) and CSV has no concept of tabs.
//
// Data sources (see src/app/CLAUDE.md § Products):
//   • country = additional_metadata ->> 'country_name'  (the tab)
//   • region  = additional_metadata ->> 'region'
//   • color   = additional_metadata ->> 'color'
//   • vendor  = additional_metadata ->> 'vendor'
//   • name    = product.name
//   • price   = product.price (numeric → number)
//   • stock   = product.total_stock

// Bilingual header row, matching the reference file 1:1.
const HEADERS = [
  "регион / region",
  "цвет / color",
  "производитель / vendor",
  "название / name",
  "цена / price",
  "остаток / total_stock",
] as const

// Products with no country_name land here (≈70 rows in the IN4COM catalog).
const NO_COUNTRY_SHEET = "Без страны"

type ExportRow = {
  name: string
  price: number | null
  totalStock: number | null
  region: string | null
  color: string | null
  vendor: string | null
  country: string | null
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { activeOrgId }
}

// Excel sheet-name rules: ≤31 chars, none of  []:*?/\  , non-empty, unique.
function sanitizeSheetName(raw: string, used: Set<string>): string {
  let name = raw.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31)
  if (!name) name = "Sheet"
  let candidate = name
  let n = 2
  while (used.has(candidate.toLowerCase())) {
    // Reserve room for the " (n)" suffix within the 31-char limit.
    const suffix = ` (${n})`
    candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`
    n++
  }
  used.add(candidate.toLowerCase())
  return candidate
}

// Cyrillic-aware comparator; blanks (null/empty) sort to the end so named
// groups come first and the unattributed tail collects at the bottom.
function cmp(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b, "ru")
}

function buildSheet(workbook: ExcelJS.Workbook, sheetName: string, rows: ExportRow[]) {
  const ws = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  })
  ws.columns = [
    { width: 22 },
    { width: 16 },
    { width: 26 },
    { width: 46 },
    { width: 12 },
    { width: 14 },
  ]

  const header = ws.addRow([...HEADERS])
  header.font = { bold: true }
  header.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFEFEF" },
    }
    cell.alignment = { vertical: "middle" }
  })

  // Sort hierarchically, then blank repeated group cells (outline style):
  // a column is blanked when it AND every ancestor equals the previous row.
  const sorted = [...rows].sort(
    (a, b) =>
      cmp(a.region ?? "", b.region ?? "") ||
      cmp(a.color ?? "", b.color ?? "") ||
      cmp(a.vendor ?? "", b.vendor ?? "") ||
      cmp(a.name, b.name),
  )

  let prevRegion: string | null = null
  let prevColor: string | null = null
  let prevVendor: string | null = null

  for (const r of sorted) {
    const region = (r.region ?? "").trim()
    const color = (r.color ?? "").trim()
    const vendor = (r.vendor ?? "").trim()

    const showRegion = region !== prevRegion
    const showColor = showRegion || color !== prevColor
    const showVendor = showColor || vendor !== prevVendor

    ws.addRow([
      showRegion ? region : "",
      showColor ? color : "",
      showVendor ? vendor : "",
      r.name,
      r.price ?? "",
      r.totalStock ?? "",
    ])

    prevRegion = region
    prevColor = color
    prevVendor = vendor
  }
}

// Builds the full price-list workbook for the caller's active organization and
// returns it as an XLSX buffer. The API route is a thin auth wrapper around it.
export async function buildPriceListWorkbook(): Promise<{
  buffer: ArrayBuffer
  fileName: string
}> {
  const { activeOrgId } = await requireOrgContext()

  const rows = (await db
    .select({
      name: product.name,
      price: product.price,
      totalStock: product.totalStock,
      region: sql<string | null>`${product.additionalMetadata} ->> 'region'`,
      color: sql<string | null>`${product.additionalMetadata} ->> 'color'`,
      vendor: sql<string | null>`${product.additionalMetadata} ->> 'vendor'`,
      country: sql<string | null>`${product.additionalMetadata} ->> 'country_name'`,
    })
    .from(product)
    .where(and(eq(product.organizationId, activeOrgId), eq(product.status, "active")))
    .orderBy(asc(product.name))) as Array<{
    name: string
    price: string | null
    totalStock: number | null
    region: string | null
    color: string | null
    vendor: string | null
    country: string | null
  }>

  // Bucket by country.
  const byCountry = new Map<string, ExportRow[]>()
  for (const r of rows) {
    const country = (r.country ?? "").trim() || NO_COUNTRY_SHEET
    const list = byCountry.get(country) ?? []
    list.push({
      name: r.name,
      price: r.price === null ? null : Number(r.price),
      totalStock: r.totalStock,
      region: r.region,
      color: r.color,
      vendor: r.vendor,
      country,
    })
    byCountry.set(country, list)
  }

  // Largest catalogs first; the "no country" bucket always last.
  const countries = [...byCountry.keys()].sort((a, b) => {
    if (a === NO_COUNTRY_SHEET) return 1
    if (b === NO_COUNTRY_SHEET) return -1
    return (byCountry.get(b)?.length ?? 0) - (byCountry.get(a)?.length ?? 0)
  })

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Truffalo"
  const usedNames = new Set<string>()

  if (countries.length === 0) {
    // Empty catalog — still hand back a valid (empty) workbook with headers.
    buildSheet(workbook, "Price list", [])
  } else {
    for (const country of countries) {
      const sheetName = sanitizeSheetName(country, usedNames)
      buildSheet(workbook, sheetName, byCountry.get(country) ?? [])
    }
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer
  const stamp = new Date().toISOString().slice(0, 10)
  return { buffer, fileName: `AST-price-list-${stamp}.xlsx` }
}
