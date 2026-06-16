import { NextRequest, NextResponse } from "next/server"
import { listClients, createClient, updateClient } from "@/server/clients"
import { getServerSession } from "@/lib/get-session"
import {
  getClientDetail,
  ClientContentScopeError,
  type ClientDetail,
} from "@/server/client-content"

export { type ClientRow, type ClientContactPreview } from "@/server/clients"
export type { ClientDetail }

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest) {
  try {
    // ?id= → single client detail (header + contacts) for the AI-chat
    // result card's "open detail" panel. Tenant-scoped on the active org.
    const id = new URL(request.url).searchParams.get("id")
    if (id) {
      const session = await getServerSession()
      const activeOrgId = session?.session.activeOrganizationId
      if (!session || !activeOrgId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
      }
      try {
        const client = await getClientDetail(activeOrgId, id)
        return NextResponse.json({ client })
      } catch (e) {
        if (e instanceof ClientContentScopeError) {
          return NextResponse.json(
            { error: e.message },
            { status: e.reason === "forbidden" ? 403 : 404 },
          )
        }
        throw e
      }
    }
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
