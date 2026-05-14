import { NextRequest, NextResponse } from "next/server"
import {
  getSystemRules,
  getCustomRules,
  createRule,
  updateRule,
  softDeleteRule,
} from "@/server/rules"

export { type RuleRow } from "@/server/rules"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status = message === "Unauthorized" ? 403 : 500
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") || "Custom"
    const search = searchParams.get("search") || undefined
    const organizationId = searchParams.get("organizationId") || undefined

    const rules =
      type === "System"
        ? await getSystemRules(search)
        : await getCustomRules(search, organizationId)

    return NextResponse.json({ rules })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, content, type } = body
    if (!name || !type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 },
      )
    }
    const result = await createRule({ name, content: content ?? "", type })
    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, name, content } = body
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    await updateRule(id, { name, content })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    await softDeleteRule(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
