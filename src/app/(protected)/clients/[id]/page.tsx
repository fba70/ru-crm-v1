import { notFound, redirect } from "next/navigation"
import { getServerSession } from "@/lib/get-session"
import {
  ClientContentScopeError,
  getClientDetail,
} from "@/server/client-content"
import { listOrgSources } from "@/server/sources"
import { ClientDetailShell } from "@/components/blocks/client-detail-shell"

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession()
  if (!session) redirect("/sign-in")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) redirect("/")

  const { id } = await params

  let detail
  try {
    detail = await getClientDetail(activeOrgId, id)
  } catch (error) {
    if (error instanceof ClientContentScopeError) {
      // Both not_found and forbidden render as 404 to avoid leaking the
      // existence of clients in other orgs.
      notFound()
    }
    throw error
  }

  // Source dropdown for the Client Content table.
  const sources = await listOrgSources(activeOrgId)

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">CLIENT</h1>
      <div className="w-full max-w-7xl px-4">
        <ClientDetailShell detail={detail} sources={sources} />
      </div>
    </div>
  )
}
