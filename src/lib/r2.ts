import "server-only"
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3"

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

// Batch-delete objects by key. Used by the admin source-teardown tool to
// remove the parsed-markdown blobs of the items it hard-deletes. S3's
// DeleteObjects caps at 1000 keys per call, so we chunk. Idempotent: deleting
// a missing key is a no-op (S3 returns success for absent keys). Empty input
// short-circuits. Returns the count of keys requested for deletion.
export async function deleteFromR2(keys: string[]): Promise<number> {
  const cleaned = keys.filter((k) => typeof k === "string" && k.length > 0)
  if (cleaned.length === 0) return 0
  if (!bucketName) throw new Error("R2_BUCKET_NAME is not configured")
  const client = getClient()
  for (let i = 0; i < cleaned.length; i += 1000) {
    const chunk = cleaned.slice(i, i + 1000)
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    )
  }
  return cleaned.length
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
