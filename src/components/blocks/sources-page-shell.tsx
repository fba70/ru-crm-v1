"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableSourceItems } from "@/components/tables/table-source-items"
import { TableOrgSources } from "@/components/tables/table-org-sources"
import { TableStoredContent } from "@/components/tables/table-stored-content"
import { DropoffUploadDialog } from "@/components/blocks/dropoff-upload-dialog"
import { WhatsAppArchiveDialog } from "@/components/blocks/whatsapp-archive-dialog"
import { SyncActionBar } from "@/components/blocks/sync-action-bar"
import { WorkflowStatistics } from "@/components/blocks/workflow-statistics"
import type { SourceSummary } from "@/server/sources"

// Client wrapper that owns the cross-component refresh + drop-off
// upload-dialog state. Lives here (not on the page) so the page itself
// can stay a server component that fetches the sources dictionary.
//
// Tabs (left → right):
//   • Organization sources       — items from sources owned by the
//     caller's active org. Default tab.
//   • Stored content             — admin / org-owner audit table over
//     every source_item belonging to the active org. Filterable, with
//     R2 markdown preview.
//   • Processing statistics      — admin-only. Pipeline run history +
//     error breakdown. Renders the existing <WorkflowStatistics> card.
//   • Manage organization sources — owner-only. Lets the org owner
//     toggle Auto Parse and Active per source. Hidden for members.
//
// The legacy "System sources" tab was removed when org-level
// instantiation became the canonical path — Phase 2 will reintroduce a
// platform-admin-only template management surface separately, so org
// members never see system rows directly.
export function SourcesPageShell({
  orgSources,
  hasActiveOrg,
  isAdmin,
  isOrgOwner,
}: {
  orgSources: SourceSummary[]
  hasActiveOrg: boolean
  isAdmin: boolean
  isOrgOwner: boolean
}) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [whatsAppOpen, setWhatsAppOpen] = useState(false)
  const bumpRefresh = () => setRefreshKey((k) => k + 1)

  // Stored Content is admin OR org-owner. Processing Statistics is
  // admin-only (per the user's call: hide it from owners).
  const showStored = isAdmin || isOrgOwner
  const showStats = isAdmin

  return (
    <Tabs defaultValue="org" className="space-y-6">
      <TabsList>
        <TabsTrigger value="org">Organization sources</TabsTrigger>
        {showStored && (
          <TabsTrigger value="stored">Stored content</TabsTrigger>
        )}
        {showStats && (
          <TabsTrigger value="stats">Processing statistics</TabsTrigger>
        )}
        {isOrgOwner && (
          <TabsTrigger value="manage">Manage organization sources</TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="org" className="space-y-6">
        {hasActiveOrg ? (
          <SourcesScope
            sources={orgSources}
            refreshKey={refreshKey}
            onBumpRefresh={bumpRefresh}
            onOpenDropoffUpload={() => setUploadOpen(true)}
            onOpenWhatsAppUpload={() => setWhatsAppOpen(true)}
          />
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No active organization on this session.
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {showStored && (
        <TabsContent value="stored" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stored content</CardTitle>
            </CardHeader>
            <CardContent>
              <TableStoredContent sources={orgSources} />
            </CardContent>
          </Card>
        </TabsContent>
      )}

      {showStats && (
        <TabsContent value="stats" className="space-y-6">
          <WorkflowStatistics />
        </TabsContent>
      )}

      {isOrgOwner && (
        <TabsContent value="manage" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organization sources</CardTitle>
            </CardHeader>
            <CardContent>
              <TableOrgSources />
            </CardContent>
          </Card>
        </TabsContent>
      )}

      <DropoffUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={bumpRefresh}
      />
      <WhatsAppArchiveDialog
        open={whatsAppOpen}
        onOpenChange={setWhatsAppOpen}
        onUploaded={bumpRefresh}
      />
    </Tabs>
  )
}

// Org sources view — action bar + Pending + Processed. The underlying
// table component still accepts a `scope` prop ("org" | "system") for
// future template-management surfaces; here we always pass "org" since
// org members never see system rows directly.
function SourcesScope({
  sources,
  refreshKey,
  onBumpRefresh,
  onOpenDropoffUpload,
  onOpenWhatsAppUpload,
}: {
  sources: SourceSummary[]
  refreshKey: number
  onBumpRefresh: () => void
  onOpenDropoffUpload: () => void
  onOpenWhatsAppUpload: () => void
}) {
  if (sources.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No sources configured for this organization yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <SyncActionBar
        sources={sources}
        onSynced={onBumpRefresh}
        onOpenDropoffUpload={onOpenDropoffUpload}
        onOpenWhatsAppUpload={onOpenWhatsAppUpload}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending</CardTitle>
        </CardHeader>
        <CardContent>
          <TableSourceItems
            status="pending"
            scope="org"
            sources={sources}
            refreshKey={refreshKey}
            onActionComplete={onBumpRefresh}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Processed</CardTitle>
        </CardHeader>
        <CardContent>
          <TableSourceItems
            status="processed"
            scope="org"
            sources={sources}
            refreshKey={refreshKey}
            onActionComplete={onBumpRefresh}
          />
        </CardContent>
      </Card>
    </>
  )
}
