import { NextRequest, NextResponse } from "next/server"
import { getActiveOrganization } from "@/server/organizations"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get("userId")

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 })
  }

  try {
    const organization = await getActiveOrganization(userId)
    return NextResponse.json({ organization })
  } catch (error) {
    console.error("Error fetching active organization:", error)
    return NextResponse.json(
      { error: "Failed to fetch organization" },
      { status: 500 }
    )
  }
}
