import "server-only"
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

// R2 is S3-compatible. The endpoint can be either the global form
// (`https://<account>.r2.cloudflarestorage.com`) or a jurisdictional one
// (`https://<account>.eu.r2.cloudflarestorage.com`). We trust whatever the
// env var holds and only fall back to the constructed global URL.
const accountId = process.env.R2_ACCOUNT_ID
const accessKeyId = process.env.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
const bucketName = process.env.R2_BUCKET_NAME
const endpoint =
  process.env.R2_PUBLIC_URL ??
  (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined)

let cachedClient: S3Client | null = null

function getClient(): S3Client {
  if (cachedClient) return cachedClient
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      "R2 not configured: set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_PUBLIC_URL (or R2_ACCOUNT_ID).",
    )
  }
  cachedClient = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  })
  return cachedClient
}

export async function putMarkdownToR2(
  key: string,
  markdown: string,
): Promise<{ key: string; sizeBytes: number }> {
  if (!bucketName) throw new Error("R2_BUCKET_NAME is not configured")
  const body = new TextEncoder().encode(markdown)
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: "text/markdown; charset=utf-8",
    }),
  )
  return { key, sizeBytes: body.byteLength }
}

export async function getMarkdownFromR2(key: string): Promise<string> {
  if (!bucketName) throw new Error("R2_BUCKET_NAME is not configured")
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: bucketName, Key: key }),
  )
  if (!res.Body) throw new Error(`R2 object empty: ${key}`)
  // The S3 SDK's `Body` exposes a `.transformToString()` helper that
  // handles both Node Readable and web ReadableStream variants.
  return await res.Body.transformToString("utf-8")
}
