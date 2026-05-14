import { NextRequest, NextResponse } from "next/server"
import {
  listTasks,
  listOrgMembers,
  listTaskClientOptions,
  listTaskContactOptions,
  listTaskDealOptions,
  createTask,
  updateTask,
  updateTaskStatus,
} from "@/server/tasks"

export {
  type TaskRow,
  type OrgMemberOption,
  type TaskClientOption,
  type TaskContactOption,
  type TaskDealOption,
} from "@/server/tasks"

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
    const url = new URL(request.url)
    if (url.searchParams.get("members") === "1") {
      const members = await listOrgMembers()
      return NextResponse.json({ members })
    }
    if (url.searchParams.get("clientOptions") === "1") {
      const options = await listTaskClientOptions()
      return NextResponse.json({ options })
    }
    if (url.searchParams.get("contactOptions") === "1") {
      const clientId = url.searchParams.get("clientId")
      const options = await listTaskContactOptions(clientId)
      return NextResponse.json({ options })
    }
    if (url.searchParams.get("dealOptions") === "1") {
      const clientId = url.searchParams.get("clientId")
      const options = await listTaskDealOptions(clientId)
      return NextResponse.json({ options })
    }
    const tasks = await listTasks()
    return NextResponse.json({ tasks })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name,
      description,
      type,
      priority,
      status,
      assigneeId,
      clientId,
      contactId,
      dealId,
      dueDate,
    } = body
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    const result = await createTask({
      name,
      description,
      type,
      priority,
      status,
      assigneeId,
      clientId,
      contactId,
      dealId,
      dueDate,
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
      statusOnly,
      status,
      name,
      description,
      type,
      priority,
      assigneeId,
      clientId,
      contactId,
      dealId,
      dueDate,
    } = body
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    if (statusOnly) {
      if (!status) {
        return NextResponse.json(
          { error: "status is required" },
          { status: 400 },
        )
      }
      await updateTaskStatus(id, status)
      return NextResponse.json({ success: true })
    }
    await updateTask(id, {
      name,
      description,
      type,
      priority,
      status,
      assigneeId,
      clientId,
      contactId,
      dealId,
      dueDate,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
