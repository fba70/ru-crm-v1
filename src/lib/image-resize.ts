// Уменьшает выбранную картинку в браузере до квадрата maxSize×maxSize (обрезка
// по центру) и перекодирует в WebP — он сохраняет прозрачность (PNG-логотип
// остаётся без фона, в отличие от JPEG с белой заливкой). Для аватарок и
// логотипов: 256px хватает на любой показ в интерфейсе, а фото с телефона на
// несколько МБ превращается в ~20–40 КБ.
export async function resizeImageToSquare(
  file: File,
  maxSize = 256,
  quality = 0.88,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const target = Math.min(maxSize, side)
  const canvas = document.createElement("canvas")
  canvas.width = target
  canvas.height = target
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas недоступен")
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    target,
    target,
  )
  bitmap.close()
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Не удалось обработать картинку"))),
      "image/webp",
      quality,
    ),
  )
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
