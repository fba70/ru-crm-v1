import { NextRequest, NextResponse } from "next/server"
import {
  getAdminOrganizations,
  updateAdminOrganization,
} from "@/server/admin-organizations"

export { type AdminOrg } from "@/server/admin-organizations"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const searchName = searchParams.get("searchName") || ""
  const limit = parseInt(searchParams.get("limit") || "10")
  const offset = parseInt(searchParams.get("offset") || "0")

  try {
    const result = await getAdminOrganizations(searchName, limit, offset)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    console.error("Error fetching organizations:", error)
    return NextResponse.json(
      { error: "Failed to fetch organizations" },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, name, slug, logo, taxId } = body

    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId is required" },
        { status: 400 },
      )
    }

    await updateAdminOrganization(organizationId, { name, slug, logo, taxId })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    console.error("Error updating organization:", error)
    return NextResponse.json(
      { error: "Failed to update organization" },
      { status: 500 },
    )
  }
}
