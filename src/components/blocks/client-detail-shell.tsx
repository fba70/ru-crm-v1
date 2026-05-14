"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ArrowLeft,
  Globe,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  User,
} from "lucide-react"
import ClientEditDialog from "@/components/forms/form-client-edit"
import ContactEditDialog from "@/components/forms/form-contact-edit"
import { ClientLookupDialog } from "@/components/blocks/client-lookup-dialog"
import { ClientContentTable } from "@/components/blocks/client-content-table"
import type { ClientDetail } from "@/server/client-content"
import type { ClientRow } from "@/app/api/clients/route"
import type { SourceSummary } from "@/server/sources"

const PHASE_COLOR: Record<string, string> = {
  awareness: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  interest: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  decision: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  action: "bg-green-500/15 text-green-600 dark:text-green-300",
  retention: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
}

const CONTACTS_PAGE_SIZE = 5

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ClientDetailShell({
  detail,
  sources,
}: {
  detail: ClientDetail
  sources: SourceSummary[]
}) {
  const router = useRouter()
  const refresh = () => router.refresh()

  // ClientEditDialog expects the existing list-shape (ClientRow with
  // ClientContactPreview[]). Build the slimmer row from the detail so
  // the dialog can be reused unchanged.
  const clientRowForEdit = useMemo<ClientRow>(
    () => ({
      id: detail.id,
      name: detail.name,
      phone: detail.phone,
      email: detail.email,
      address: detail.address,
      webUrl: detail.webUrl,
      funnelPhase: detail.funnelPhase,
      status: detail.status,
      userId: detail.userId,
      userName: detail.userName,
      organizationId: detail.organizationId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      contacts: detail.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        position: c.position,
        status: c.status,
      })),
    }),
    [detail],
  )

  const [contactPage, setContactPage] = useState(1)
  const totalContactPages = Math.max(
    1,
    Math.ceil(detail.contacts.length / CONTACTS_PAGE_SIZE),
  )
  const effectiveContactPage = Math.min(contactPage, totalContactPages)
  const contactStart = (effectiveContactPage - 1) * CONTACTS_PAGE_SIZE
  const visibleContacts = detail.contacts.slice(
    contactStart,
    contactStart + CONTACTS_PAGE_SIZE,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/clients">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to clients
          </Link>
        </Button>
      </div>

      {/* Big client card */}
      <Card className="dark:border-gray-600">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-2xl truncate">{detail.name}</CardTitle>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge
                className={PHASE_COLOR[detail.funnelPhase] ?? ""}
                variant="secondary"
              >
                {detail.funnelPhase}
              </Badge>
              {detail.status !== "active" && (
                <Badge variant="outline" className="text-muted-foreground">
                  {detail.status}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ClientLookupDialog
              client={clientRowForEdit}
              onSaved={refresh}
              trigger={
                <Button variant="outline" size="sm">
                  <Globe className="h-4 w-4 mr-1" />
                  Lookup on web
                </Button>
              }
            />
            <ClientEditDialog
              mode="edit"
              client={clientRowForEdit}
              onSuccess={refresh}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              }
            />
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-muted-foreground">
          <DetailRow icon={<Mail className="h-4 w-4" />} value={detail.email} />
          <DetailRow icon={<Phone className="h-4 w-4" />} value={detail.phone} />
          <DetailRow
            icon={<MapPin className="h-4 w-4" />}
            value={detail.address}
          />
          <DetailRow
            icon={<Globe className="h-4 w-4" />}
            value={detail.webUrl}
            href={detail.webUrl ?? undefined}
          />
          <div className="flex items-center gap-2 sm:col-span-2 text-xs">
            <User className="h-3.5 w-3.5" />
            <span>
              Created by {detail.userName ?? "—"} on{" "}
              {formatDateTime(detail.createdAt)}
              {detail.updatedAt !== detail.createdAt && (
                <> · Updated {formatDateTime(detail.updatedAt)}</>
              )}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Contacts list (active + suspended) */}
      <Card className="dark:border-gray-600">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            Contacts ({detail.contacts.length})
          </CardTitle>
          <ContactEditDialog
            mode="create"
            onSuccess={refresh}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                New contact
              </Button>
            }
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {detail.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No contacts linked to this client yet.
            </p>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden">
                <Table className="table-fixed w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-56">Email</TableHead>
                      <TableHead className="w-36">Phone</TableHead>
                      <TableHead className="w-40">Position</TableHead>
                      <TableHead className="w-24">Status</TableHead>
                      <TableHead className="w-12">Edit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleContacts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium truncate">
                          {c.name}
                        </TableCell>
                        <TableCell className="text-xs truncate">
                          {c.email ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs truncate">
                          {c.phone ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs truncate">
                          {c.position ?? "—"}
                        </TableCell>
                        <TableCell>
                          {c.status === "active" ? (
                            <Badge
                              variant="secondary"
                              className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            >
                              active
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-muted-foreground"
                            >
                              {c.status}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <ContactEditDialog
                            mode="edit"
                            contact={c}
                            onSuccess={refresh}
                            trigger={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                aria-label="Edit contact"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalContactPages > 1 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Page {effectiveContactPage} of {totalContactPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={effectiveContactPage <= 1}
                      onClick={() => setContactPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={effectiveContactPage >= totalContactPages}
                      onClick={() =>
                        setContactPage((p) =>
                          Math.min(totalContactPages, p + 1),
                        )
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Client Content table */}
      <Card className="dark:border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">Client Content</CardTitle>
          <p className="text-xs text-muted-foreground">
            Parsed source items relevant to this client (matched on name,
            address, website, and contact names/emails). Only R2-uploaded
            content is shown — full markdown body search will come later.
          </p>
        </CardHeader>
        <CardContent>
          <ClientContentTable clientId={detail.id} sources={sources} />
        </CardContent>
      </Card>
    </div>
  )
}

function DetailRow({
  icon,
  value,
  href,
}: {
  icon: React.ReactNode
  value: string | null
  href?: string
}) {
  if (!value) {
    return (
      <div className="flex items-center gap-2 opacity-50">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">—</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0">{icon}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate hover:underline text-blue-600 dark:text-blue-400"
        >
          {value}
        </a>
      ) : (
        <span className="truncate">{value}</span>
      )}
    </div>
  )
}
