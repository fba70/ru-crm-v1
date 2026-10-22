import "server-only"

import { getServerSession } from "@/lib/get-session"
import { getBinaryFromR2, putBinaryToR2 } from "@/lib/r2"

// Фото профиля. `user.image` нельзя хранить как data URL: better-auth кладёт
// все поля пользователя в подписанную куку сессии (cookieCache), и картинка
// на десятки КБ переполняет лимит заголовка → 431 на каждом запросе (см.
// root CLAUDE.md § Multi-Tenancy). Поэтому байты лежат в R2, а в
// `user.image` — короткая ссылка на маршрут, который их отдаёт.

export const AVATAR_MAX_BYTES = 512 * 1024
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export class AvatarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const avatarKey = (userId: string) => `avatars/user_${userId}`

async function requireUserId(): Promise<string> {
  const session = await getServerSession()
  if (!session?.user?.id) throw new AvatarError("Unauthorized", 401)
  return session.user.id
}

// Сохраняет фото текущего пользователя и возвращает ссылку для `user.image`.
// Параметр `v` ломает кэш браузера после замены фото (ключ в R2 тот же).
export async function uploadCurrentUserAvatar(
  bytes: Uint8Array,
  contentType: string,
): Promise<{ url: string }> {
  const userId = await requireUserId()
  if (!AVATAR_TYPES.has(contentType)) {
    throw new AvatarError("Допустимы только JPEG, PNG или WebP", 400)
  }
  if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_MAX_BYTES) {
    throw new AvatarError("Файл должен быть меньше 512 КБ", 400)
  }
  await putBinaryToR2(avatarKey(userId), bytes, contentType)
  return { url: `/api/avatars/${userId}?v=${Date.now()}` }
}

// Отдаёт фото любого пользователя любому вошедшему — аватарки видны коллегам
// (сайдбар, списки участников), как и раньше были видны data URL.
export async function getUserAvatar(
  userId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  await requireUserId()
  return getBinaryFromR2(avatarKey(userId))
}
