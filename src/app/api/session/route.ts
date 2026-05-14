import { authClient } from "@/lib/auth-client"
import { NextResponse } from "next/server"

export async function GET() {
  const { data: session } = await authClient.getSession()
  return NextResponse.json(session)
}
