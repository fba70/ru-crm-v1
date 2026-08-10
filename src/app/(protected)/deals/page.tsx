import {
  listDeals,
  listDealFunnelStages,
  listDealClientOptions,
} from "@/server/deals"
import { getServerSession } from "@/lib/get-session"
import { DealsBoard } from "@/components/blocks/deals-board"

export default async function DealsPage() {
  const [deals, stages, clientOptions, session] = await Promise.all([
    listDeals({ includeCancelled: true, includeDeleted: true }),
    listDealFunnelStages(),
    listDealClientOptions(),
    getServerSession(),
  ])
  const currentUserId = session?.user.id ?? ""

  return (
    // Атмосферный фон приходит из (protected)/layout.tsx — общий для продукта.
    <div className="h-[calc(100vh-1rem)]">
      <DealsBoard
        deals={deals}
        stages={stages}
        currentUserId={currentUserId}
        clientOptions={clientOptions}
      />
    </div>
  )
}
