import { getActiveOrgRole, listOrgSources } from "@/server/sources"
import { getServerSession } from "@/lib/get-session"
import { SourcesPageShell } from "@/components/blocks/sources-page-shell"
import { GlobalSearch } from "@/components/blocks/global-search"
import { AiChatTrigger } from "@/components/blocks/global-ai-chat"

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
    <div className="flex flex-col gap-4 p-4 pb-10 min-h-screen">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-medium">Источники данных</h1>
        <div className="flex items-center gap-2">
          <AiChatTrigger />
          <GlobalSearch />
        </div>
      </div>

      <div className="w-full space-y-6">
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
