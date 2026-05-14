import { NextResponse } from "next/server"
import { getAdminUserOrganizations } from "@/server/admin-organizations"

export { type UserOrgInfo } from "@/server/admin-organizations"

export async function GET() {
  try {
    const result = await getAdminUserOrganizations()
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    console.error("Error fetching user organizations:", error)
    return NextResponse.json(
      { error: "Failed to fetch user organizations" },
      { status: 500 },
    )
  }
}
