import { NextRequest, NextResponse } from "next/server"
import {
  listCards,
  getCard,
  createCard,
  updateCard,
  acceptCard,
  rejectCard,
  deleteCard,
} from "@/server/cards"

export {
  type CardRow,
  type CardMessage,
  type CardClientRef,
  type CardUserRef,
  type CardContactRef,
} from "@/server/cards"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message.endsWith("not found")
        ? 404
        : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest) {
  try {
    // `?id=` → single card (used by the /products "Create order" handoff to
    // fetch the linked client + verbatim order request). Otherwise the list.
    const id = request.nextUrl.searchParams.get("id")
    if (id) {
      const card = await getCard(id)
      if (!card) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 })
      }
      return NextResponse.json({ card })
    }
    const cards = await listCards()
    return NextResponse.json({ cards })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      priority,
      category,
      message,
      sourceItemId,
      ruleId,
      clientIds,
      userIds,
      contactIds,
    } = body
    if (!category) {
      return NextResponse.json(
        { error: "category is required" },
        { status: 400 },
      )
    }
    const result = await createCard({
      priority,
      category,
      message,
      sourceItemId,
      ruleId,
      clientIds,
      userIds,
      contactIds,
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
      action,
      rejectionReason,
      priority,
      category,
      message,
      sourceItemId,
      ruleId,
      clientIds,
      userIds,
      contactIds,
    } = body
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    if (action === "accept") {
      await acceptCard(id)
      return NextResponse.json({ success: true })
    }
    if (action === "reject") {
      if (!rejectionReason || typeof rejectionReason !== "string") {
        return NextResponse.json(
          { error: "rejectionReason is required" },
          { status: 400 },
        )
      }
      await rejectCard(id, rejectionReason)
      return NextResponse.json({ success: true })
    }
    await updateCard(id, {
      priority,
      category,
      message,
      sourceItemId,
      ruleId,
      clientIds,
      userIds,
      contactIds,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    await deleteCard(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
