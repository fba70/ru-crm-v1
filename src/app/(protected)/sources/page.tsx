import { getActiveOrgRole, listOrgSources } from "@/server/sources"
import { getServerSession } from "@/lib/get-session"
import { SourcesPageShell } from "@/components/blocks/sources-page-shell"

export default async function SourcesPage() {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId ?? null
  const isAdmin = session?.user?.role === "admin"

  const [orgSources, activeRole] = await Promise.all([
    activeOrgId ? listOrgSources(activeOrgId) : Promise.resolve([]),
    getActiveOrgRole(),
  ])

  // Owner-only "Manage organization sources" tab is gated server-side.
  // The shell also relies on isAdmin / isOrgOwner to decide whether to
  // render the "Stored content" + "Processing statistics" tabs — but
  // the underlying API routes do their own role checks, so a manually-
  // flipped flag would still 403.
  const isOrgOwner = activeRole?.role === "owner"

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">SOURCES</h1>

      <div className="w-full max-w-7xl px-4 space-y-6">
        <SourcesPageShell
          orgSources={orgSources}
          hasActiveOrg={Boolean(activeOrgId)}
          isAdmin={isAdmin}
          isOrgOwner={isOrgOwner}
        />
      </div>
    </div>
  )
}
