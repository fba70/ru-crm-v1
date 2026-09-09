"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Building2, Handshake, Package, Search, User } from "lucide-react"
import type { GlobalSearchResult } from "@/app/api/search/route"
import { ORDER_STATUS_LABEL, formatOrderDate } from "@/lib/orders-format"

const EMPTY_RESULT: GlobalSearchResult = {
  query: "",
  clients: [],
  contacts: [],
  deals: [],
  orders: [],
}

export function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<GlobalSearchResult>(EMPTY_RESULT)
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResult(EMPTY_RESULT)
      setLoading(false)
      return
    }
    setLoading(true)
    const reqId = ++reqIdRef.current
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        if (reqIdRef.current !== reqId) return
        if (res.ok) {
          const data: GlobalSearchResult = await res.json()
          if (reqIdRef.current === reqId) setResult(data)
        }
      } finally {
        if (reqIdRef.current === reqId) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const reset = useCallback(() => {
    setQuery("")
    setResult(EMPTY_RESULT)
  }, [])

  function go(path: string) {
    setOpen(false)
    reset()
    router.push(path)
  }

  const hasResults =
    result.clients.length > 0 ||
    result.contacts.length > 0 ||
    result.deals.length > 0 ||
    result.orders.length > 0

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground w-full justify-start gap-2 sm:w-64"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Поиск…</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) reset()
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Глобальный поиск</DialogTitle>
          <DialogDescription>
            Поиск по компаниям, контактам, сделкам и заказам
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="overflow-hidden p-0" showCloseButton>
        <Command
          shouldFilter={false}
          className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3"
        >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Компании, контакты, сделки, заказы…"
        />
        <CommandList>
          {query.trim().length < 2 ? (
            <CommandEmpty>Введите минимум 2 символа</CommandEmpty>
          ) : loading ? (
            <CommandEmpty>Поиск…</CommandEmpty>
          ) : !hasResults ? (
            <CommandEmpty>Ничего не найдено</CommandEmpty>
          ) : null}

          {result.clients.length > 0 && (
            <CommandGroup heading="Компании">
              {result.clients.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`client-${c.id}`}
                  onSelect={() => go(`/clients/${c.id}`)}
                >
                  <Building2 />
                  <div className="flex flex-col">
                    <span>{c.name}</span>
                    {c.email && (
                      <span className="text-muted-foreground text-xs">
                        {c.email}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {result.contacts.length > 0 && (
            <CommandGroup heading="Контакты">
              {result.contacts.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`contact-${c.id}`}
                  onSelect={() => go(`/contacts?openContact=${c.id}`)}
                >
                  <User />
                  <div className="flex flex-col">
                    <span>{c.name}</span>
                    {c.clientName && (
                      <span className="text-muted-foreground text-xs">
                        {c.clientName}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {result.deals.length > 0 && (
            <CommandGroup heading="Сделки">
              {result.deals.map((d) => (
                <CommandItem
                  key={d.id}
                  value={`deal-${d.id}`}
                  onSelect={() => go(`/deals?openDeal=${d.id}`)}
                >
                  <Handshake />
                  <div className="flex flex-col">
                    <span>{d.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {[d.clientName, d.funnelStageName]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {result.orders.length > 0 && (
            <CommandGroup heading="Заказы">
              {result.orders.map((o) => (
                <CommandItem
                  key={o.id}
                  value={`order-${o.id}`}
                  onSelect={() => go(`/products?openOrder=${o.id}`)}
                >
                  <Package />
                  <div className="flex flex-col">
                    <span>{o.clientName ?? "Без клиента"}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatOrderDate(o.orderDate)} ·{" "}
                      {ORDER_STATUS_LABEL[
                        o.status as keyof typeof ORDER_STATUS_LABEL
                      ] ?? o.status}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
        </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}
