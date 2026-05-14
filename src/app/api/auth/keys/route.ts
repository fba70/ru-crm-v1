import { NextRequest, NextResponse } from "next/server"
import {
  createApiKey,
  deleteApiKeys,
  getAllApiKeys,
  getApiKeys,
} from "@/server/api-keys"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const keyId = searchParams.get("keyId")

  try {
    if (keyId) {
      const result = await getApiKeys(keyId)

      if (result?.error) {
        return NextResponse.json({ error: "Unknown error" }, { status: 500 })
      }

      return NextResponse.json({ data: result?.data })
    } else {
      const result = await getAllApiKeys()

      if (result?.error) {
        return NextResponse.json({ error: "Unknown error" }, { status: 500 })
      }

      // console.log("GET /api/auth/keys result:", result)

      return NextResponse.json({ data: result?.data })
    }
  } catch (error) {
    console.error("Error in GET /api/auth/keys:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, expiresIn, prefix, description } = body

    if (!name || !expiresIn || !prefix || !description) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const result = await createApiKey({ name, expiresIn, prefix, description })

    if (result?.error) {
      return NextResponse.json({ error: "Unknown error" }, { status: 500 })
    }

    return NextResponse.json({ data: result?.data }, { status: 201 })
  } catch (error) {
    console.error("Error in POST /api/auth/keys:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const keyId = searchParams.get("keyId")

  if (!keyId) {
    return NextResponse.json({ error: "keyId is required" }, { status: 400 })
  }

  try {
    const result = await deleteApiKeys(keyId)

    if (result?.error) {
      return NextResponse.json({ error: "Unknown error" }, { status: 500 })
    }

    return NextResponse.json({ data: result?.data })
  } catch (error) {
    console.error("Error in DELETE /api/auth/keys:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
