import { getInvitationForAcceptance } from "@/server/invitations"
import { AcceptInvitationContent } from "./accept-invitation-content"

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const invitation = await getInvitationForAcceptance(id)
  return <AcceptInvitationContent initialInvitation={invitation} />
}
