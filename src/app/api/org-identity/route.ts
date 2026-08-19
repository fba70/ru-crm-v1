// Own-organisation identity registry (see src/app/CLAUDE.md § "Own-organisation
// identity registry"). Read by any member, mutated by the org owner only —
// both gates live in `src/server/org-identity-registry.ts`, never here (API
// routes must not touch Drizzle; see root CLAUDE.md § Data Layer).
import { NextResponse } from "next/server"
import {
  addOrgIdentityEntry,
  canManageOrgIdentity,
  listOrgIdentityEntries,
  OrgIdentityError,
} from "@/server/org-identity-registry"
import type { OrgIdentityKind } from "@/db/schema"

export type {
  OrgIdentityEntryView,
  IdentityMatch,
  IdentityMatches,
  AddOrgIdentityResult,
} from "@/server/org-identity-registry"

const KINDS: OrgIdentityKind[] = ["name", "website", "address"]

function errorResponse(error: unknown) {
  if (error instanceof OrgIdentityError) {
    const status =
      error.reason === "unauthorized"
        ? 401
        : error.reason === "forbidden"
          ? 403
          : error.reason === "not_found"
            ? 404
            : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  const message = error instanceof Error ? error.message : "Unknown error"
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function GET() {
  try {
    const [entries, canManage] = await Promise.all([
      listOrgIdentityEntries(),
      canManageOrgIdentity(),
    ])
    return NextResponse.json({ entries, canManage })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const kind = body?.kind as OrgIdentityKind
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: "Некорректный тип" }, { status: 400 })
    }
    const result = await addOrgIdentityEntry({
      kind,
      value: String(body?.value ?? ""),
      note: body?.note ?? null,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
