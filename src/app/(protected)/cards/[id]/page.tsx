import { notFound, redirect } from "next/navigation"
import { getServerSession } from "@/lib/get-session"
import { getCard } from "@/server/cards"
import { CardDetailShell } from "@/components/blocks/card-detail-shell"

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession()
  if (!session) redirect("/sign-in")
  if (!session.session.activeOrganizationId) redirect("/")

  const { id } = await params
  const card = await getCard(id)
  // Both not-found and cross-org reads return null so existence is not
  // leaked to other orgs.
  if (!card) notFound()

  return (
    <div className="flex flex-col gap-6 items-center justify-start min-h-screen pb-8">
      <h1 className="text-2xl font-medium mt-2">CARD</h1>
      <div className="w-full max-w-4xl px-4">
        <CardDetailShell card={card} />
      </div>
    </div>
  )
}
