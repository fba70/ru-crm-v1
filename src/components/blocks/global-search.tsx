"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Command as CommandPrimitive } from "cmdk"
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  Building2,
  Handshake,
  LayoutGrid,
  Package,
  Search,
  User,
} from "lucide-react"
import type { GlobalSearchResult } from "@/app/api/search/route"
import { ORDER_STATUS_LABEL, formatOrderDate } from "@/lib/orders-format"

const EMPTY_RESULT: GlobalSearchResult = {
  query: "",
  clients: [],
  contacts: [],
  deals: [],
  orders: [],
  cards: [],
}

// Глобальный поиск в шапке: обычное поле ввода. По клику в нём только курсор;
// выпадающий список результатов открывается ПОД этим же полем с первого
// введённого символа (раньше по клику открывалась модалка в центре экрана).
// Сервер ищет с 2 символов (по одной букве совпадает почти всё), поэтому при
// одном символе список показывает подсказку. Стрелки/Enter — навигация cmdk,
// Esc и клик мимо закрывают список.
export function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
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
    ;(document.activeElement as HTMLElement | null)?.blur()
    router.push(path)
  }

  function onQueryChange(value: string) {
    setQuery(value)
    setOpen(value.trim().length > 0)
  }

  const hasResults =
    result.clients.length > 0 ||
    result.contacts.length > 0 ||
    result.deals.length > 0 ||
    result.orders.length > 0 ||
    result.cards.length > 0

  return (
    <CommandPrimitive
      shouldFilter={false}
      loop
      className="w-full sm:w-64 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-1 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div ref={anchorRef} className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <CommandPrimitive.Input
              value={query}
              onValueChange={onQueryChange}
              onFocus={() => {
                if (query.trim()) setOpen(true)
              }}
              placeholder="Поиск…"
              aria-label="Глобальный поиск"
              className={cn(
                "h-8 w-full min-w-0 rounded-md border border-input bg-transparent pl-8 pr-3 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground dark:bg-input/30",
                "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="end"
          className="w-[420px] max-w-[calc(100vw-2rem)] p-0"
          // Фокус остаётся в поле — продолжаем печатать, стрелки листают список.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // Клик по самому полю — не «клик мимо».
          onInteractOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault()
          }}
        >
          <CommandList className="max-h-[60vh]">
            {query.trim().length < 2 ? (
              <CommandEmpty>Введите ещё хотя бы один символ</CommandEmpty>
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
                    onSelect={() => go(`/clients?openClient=${c.id}`)}
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

            {result.cards.length > 0 && (
              <CommandGroup heading="Карточки">
                {result.cards.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`card-${c.id}`}
                    onSelect={() => go(`/cards/${c.id}`)}
                  >
                    <LayoutGrid />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {c.analysis || "Без описания"}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {new Date(c.createdAt).toLocaleDateString("ru-RU")}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </PopoverContent>
      </Popover>
    </CommandPrimitive>
  )
}
