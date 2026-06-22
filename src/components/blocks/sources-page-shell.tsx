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
import { ProcessRunBar } from "@/components/blocks/process-controls"
import { useProcessRun } from "@/components/blocks/use-process-run"
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
        <TabsTrigger value="org">Источники организации</TabsTrigger>
        {showStored && (
          <TabsTrigger value="stored">Сохранённые материалы</TabsTrigger>
        )}
        {showStats && (
          <TabsTrigger value="stats">Статистика обработки</TabsTrigger>
        )}
        {isOrgOwner && (
          <TabsTrigger value="manage">
            Управление источниками организации
          </TabsTrigger>
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
              В текущей сессии нет активной организации.
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {showStored && (
        <TabsContent value="stored" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Сохранённые материалы</CardTitle>
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
              <CardTitle className="text-base">Источники организации</CardTitle>
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

// Org sources view — one action bar + one unified table. The single
// `useProcessRun` instance is shared by the per-source "Синхронизировать
// и обработать" buttons AND the table's "Обработать все" control, so
// only one parse→upload run is ever in flight and both feed the same
// progress bar.
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
  const proc = useProcessRun({ onRefresh: onBumpRefresh })
  // "Processing period" — bounds which fetched items the sync→process chain
  // actually parses+uploads, by `source_created_at` (NOT a table filter).
  // Empty = all. `<input type="date">` yields YYYY-MM-DD, which is exactly
  // what /process-ids expects for date_from/date_to.
  const [procDateFrom, setProcDateFrom] = useState("")
  const [procDateTo, setProcDateTo] = useState("")

  if (sources.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Для этой организации ещё не настроены источники.
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <SyncActionBar
        sources={sources}
        onSynced={onBumpRefresh}
        onProcessSource={(sourceId, label) =>
          proc.run(
            {
              scope: "org",
              sourceId,
              dateFromIso: procDateFrom || undefined,
              dateToIso: procDateTo || undefined,
            },
            { label },
          )
        }
        processRunning={proc.running}
        processDateFrom={procDateFrom}
        processDateTo={procDateTo}
        onProcessDateFromChange={setProcDateFrom}
        onProcessDateToChange={setProcDateTo}
        onOpenDropoffUpload={onOpenDropoffUpload}
        onOpenWhatsAppUpload={onOpenWhatsAppUpload}
      />

      <ProcessRunBar
        progress={proc.progress}
        onCancel={proc.cancel}
        cancelRequested={proc.cancelRequested.current}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Материалы источников</CardTitle>
        </CardHeader>
        <CardContent>
          <TableSourceItems
            sources={sources}
            refreshKey={refreshKey}
            onActionComplete={onBumpRefresh}
            processRunning={proc.running}
            onRunAll={proc.run}
          />
        </CardContent>
      </Card>
    </>
  )
}
