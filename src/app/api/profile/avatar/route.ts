import { NextRequest, NextResponse } from "next/server"
import {
  AVATAR_MAX_BYTES,
  AvatarError,
  uploadCurrentUserAvatar,
} from "@/server/user-avatar"

// POST — тело запроса = байты картинки, тип в Content-Type. Возвращает
// { url } для `user.image`; само поле клиент сохраняет через
// authClient.updateUser, чтобы обновилась и кука сессии.
export async function POST(request: NextRequest) {
  try {
    const contentType = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
    const declared = Number(request.headers.get("content-length") ?? 0)
    if (declared > AVATAR_MAX_BYTES) {
      return NextResponse.json(
        { error: "Файл должен быть меньше 512 КБ" },
        { status: 413 },
      )
    }
    const bytes = new Uint8Array(await request.arrayBuffer())
    const result = await uploadCurrentUserAvatar(bytes, contentType)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AvatarError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Avatar upload failed:", error)
    return NextResponse.json({ error: "Не удалось сохранить фото" }, { status: 500 })
  }
}
