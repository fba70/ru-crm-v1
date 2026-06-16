import { NextRequest, NextResponse } from "next/server"
import {
  listContacts,
  createContact,
  updateContact,
  listClientOptions,
} from "@/server/contacts"

export { type ContactRow, type ClientOption } from "@/server/contacts"

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
    const { searchParams } = new URL(request.url)
    if (searchParams.get("clientOptions") === "1") {
      const options = await listClientOptions()
      return NextResponse.json({ options })
    }
    const contacts = await listContacts()
    // ?id= → single contact for the AI-chat result card's detail panel.
    // listContacts() is already org-scoped, so filtering it can't leak
    // cross-tenant rows.
    const id = searchParams.get("id")
    if (id) {
      const contact = contacts.find((c) => c.id === id)
      if (!contact) {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 })
      }
      return NextResponse.json({ contact })
    }
    return NextResponse.json({ contacts })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, nameNative, aliases, phone, email, position, clientId, status } =
      body
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    const result = await createContact({
      name,
      nameNative,
      aliases,
      phone,
      email,
      position,
      clientId,
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
      nameNative,
      aliases,
      phone,
      email,
      position,
      clientId,
      status,
    } = body
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    await updateContact(id, {
      name,
      nameNative,
      aliases,
      phone,
      email,
      position,
      clientId,
      status,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
