"use client"

import { useState, useMemo } from "react"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowUpDown } from "lucide-react"

interface ColumnConfig {
  key: string
  label: string
  type?: string
  align?: "left" | "center" | "right"
  width?: number
}

interface DataTableComponentProps {
  title?: string
  columns: ColumnConfig[]
  rows: Record<string, unknown>[]
  sortable?: boolean
  searchable?: boolean
  pageSize?: number
}

function formatCellValue(value: unknown, type?: string): string {
  if (value == null) return "—"
  switch (type) {
    case "currency":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(value)
        : String(value)
    case "percentage":
      return typeof value === "number" ? `${value}%` : String(value)
    case "boolean":
      return value ? "Yes" : "No"
    case "date":
      return typeof value === "string" || typeof value === "number"
        ? new Date(value).toLocaleDateString()
        : String(value)
    default:
      return String(value)
  }
}

export function DataTableComponent({
  title,
  columns: columnConfigs,
  rows,
  sortable = true,
  searchable = false,
  pageSize = 10,
}: DataTableComponentProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState("")

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      columnConfigs.map((col) => ({
        accessorKey: col.key,
        header: sortable
          ? ({ column }) => (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 h-8"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                {col.label}
                <ArrowUpDown className="ml-2 size-3.5" />
              </Button>
            )
          : col.label,
        cell: ({ getValue }) => {
          const val = getValue()
          const formatted = formatCellValue(val, col.type)
          const alignClass =
            col.align === "right"
              ? "text-right"
              : col.align === "center"
                ? "text-center"
                : ""
          return <span className={alignClass}>{formatted}</span>
        },
        size: col.width,
      })),
    [columnConfigs, sortable],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: { pagination: { pageSize } },
  })

  return (
    <div className="space-y-3">
      {(title || searchable) && (
        <div className="flex items-center justify-between gap-4">
          {title && <h4 className="text-sm font-semibold">{title}</h4>}
          {searchable && (
            <Input
              placeholder="Search..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="max-w-xs h-8 text-xs"
            />
          )}
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-16 text-center text-muted-foreground"
                >
                  No data
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
