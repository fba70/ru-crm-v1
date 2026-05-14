import { NextResponse } from "next/server"
import { Polar } from "@polar-sh/sdk"

const polar = new Polar({
  accessToken: process.env["POLAR_ACCESS_TOKEN"] ?? "",
  server: "sandbox",
})

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const invoiceId = searchParams.get("id")

  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoice id" }, { status: 400 })
  }

  try {
    const result = await polar.orders.invoice({
      id: invoiceId,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Polar API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch customer state" },
      { status: 500 }
    )
  }
}
