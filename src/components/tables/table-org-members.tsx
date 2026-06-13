"use client"

import { useEffect, useState, useCallback } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { authClient } from "@/lib/auth-client"
import { Loader, RefreshCcw } from "lucide-react"
import SetOrgRoleDialog from "@/components/forms/form-set-org-role"
import RemoveMemberDialog from "@/components/forms/form-remove-member"
import InviteMemberDialog from "@/components/forms/form-invite-member"

// Russian plural picker: forms = [one, few, many] (1 / 2–4 / 0,5–20).
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

// Display labels — DB enum keys stay English.
const ORG_ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
}

type OrgMember = {
  id: string
  userId: string
  role: string
  createdAt: string | Date
  user: {
    id: string
    name: string
    email: string
    image: string | null
    createdAt: string | Date
  }
}

export function TableOrgMembers({
  organizationId,
  currentUserId,
}: {
  organizationId: string
  currentUserId: string
}) {
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchName, setSearchName] = useState("")
  const [searchEmail, setSearchEmail] = useState("")

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } =
        await authClient.organization.listMembers({
          query: { organizationId },
        })

      if (fetchError) {
        setError(fetchError.message || "Не удалось загрузить участников")
        return
      }

      setMembers((data?.members as unknown as OrgMember[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка")
    } finally {
      setLoading(false)
    }
  }, [organizationId])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  const filteredMembers = members.filter((m) => {
    const nameMatch = searchName
      ? m.user.name?.toLowerCase().includes(searchName.toLowerCase())
      : true
    const emailMatch = searchEmail
      ? m.user.email?.toLowerCase().includes(searchEmail.toLowerCase())
      : true
    return nameMatch && emailMatch
  })

  if (error) {
    return (
      <div className="text-red-500 text-lg">Ошибка загрузки участников: {error}</div>
    )
  }

  return (
    <>
      <div className="flex flex-row flex-wrap items-center gap-2 mb-4">
        <Input
          placeholder="Поиск по имени"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          className="max-w-48"
        />
        <Input
          placeholder="Поиск по email"
          value={searchEmail}
          onChange={(e) => setSearchEmail(e.target.value)}
          className="max-w-48"
        />
        <Button variant="outline" onClick={fetchMembers}>
          <RefreshCcw className="h-4 w-4" />
        </Button>
        <span className="ml-auto text-sm text-gray-400 mr-4">
          {members.length} {plural(members.length, ["участник", "участника", "участников"])}
        </span>
        <InviteMemberDialog
          organizationId={organizationId}
          onSuccess={fetchMembers}
        />
      </div>

      {loading ? (
        <div className="flex justify-center p-8">
          <Loader className="animate-spin h-6 w-6 text-gray-900 dark:text-gray-100" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead>Присоединился</TableHead>
              <TableHead>Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMembers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-gray-500">
                  Участники не найдены
                </TableCell>
              </TableRow>
            ) : (
              filteredMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    {member.user.name}
                  </TableCell>
                  <TableCell>{member.user.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        member.role === "owner"
                          ? "default"
                          : member.role === "admin"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {ORG_ROLE_LABEL[member.role] ?? member.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(member.createdAt).toLocaleDateString("ru-RU")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <SetOrgRoleDialog
                        memberId={member.id}
                        memberName={member.user.name}
                        currentRole={member.role}
                        organizationId={organizationId}
                        onSuccess={fetchMembers}
                      />
                      {member.userId !== currentUserId && (
                        <RemoveMemberDialog
                          memberId={member.id}
                          memberName={member.user.name}
                          onSuccess={fetchMembers}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </>
  )
}
