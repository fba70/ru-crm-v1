import { NextRequest, NextResponse } from "next/server"
import { AvatarError, getUserAvatar } from "@/server/user-avatar"

// GET — фото профиля пользователя (байты из R2). Только для вошедших.
// Ссылка в `user.image` несёт ?v=<время загрузки>, поэтому ответ можно
// кэшировать надолго: новое фото = новый URL.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId } = await params
    const avatar = await getUserAvatar(userId)
    if (!avatar) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return new NextResponse(Buffer.from(avatar.bytes), {
      headers: {
        "content-type": avatar.contentType,
        "cache-control": "private, max-age=31536000, immutable",
      },
    })
  } catch (error) {
    if (error instanceof AvatarError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Avatar read failed:", error)
    return NextResponse.json({ error: "Не удалось загрузить фото" }, { status: 500 })
  }
}
