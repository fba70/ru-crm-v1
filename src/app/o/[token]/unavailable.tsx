import { PackageX } from "lucide-react"
import type { ResolveFailReason } from "@/server/order-links"

const COPY: Record<ResolveFailReason, { title: string; body: string }> = {
  not_found: {
    title: "Ссылка не найдена",
    body: "Эта ссылка на заказ недействительна или больше не существует.",
  },
  revoked: {
    title: "Ссылка больше не активна",
    body: "Эта ссылка на заказ была отозвана. Пожалуйста, запросите у отправителя актуальную ссылку.",
  },
  expired: {
    title: "Срок ссылки истёк",
    body: "Срок действия этой ссылки на заказ истёк. Пожалуйста, запросите у отправителя новую.",
  },
}

export function LinkUnavailable({ reason }: { reason: ResolveFailReason }) {
  const c = COPY[reason]
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md text-center space-y-3">
        <PackageX className="h-10 w-10 mx-auto text-muted-foreground" />
        <h1 className="text-xl font-semibold">{c.title}</h1>
        <p className="text-muted-foreground">{c.body}</p>
      </div>
    </div>
  )
}
