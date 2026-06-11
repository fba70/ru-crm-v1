import { NextRequest, NextResponse } from "next/server"
import { listClients, createClient, updateClient } from "@/server/clients"

export { type ClientRow, type ClientContactPreview } from "@/server/clients"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const clients = await listClients()
    return NextResponse.json({ clients })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name,
      namePhys,
      comment,
      aliases,
      phone,
      email,
      address,
      webUrl,
      customFields,
      funnelPhase,
      status,
    } = body
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    const result = await createClient({
      name,
      namePhys,
      comment,
      aliases,
      phone,
      email,
      address,
      webUrl,
      customFields,
      funnelPhase,
      status,
    })
    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      id,
      name,
      namePhys,
      comment,
      aliases,
      phone,
      email,
      address,
      webUrl,
      customFields,
      funnelPhase,
      status,
    } = body
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    await updateClient(id, {
      name,
      namePhys,
      comment,
      aliases,
      phone,
      email,
      address,
      webUrl,
      customFields,
      funnelPhase,
      status,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
