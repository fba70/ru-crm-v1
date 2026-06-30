# Валюта расчётов на уровне клиента — план

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Валюта — «валюта расчётов» клиента. Сделка берёт валюту своего клиента; «Сумма» со значком валюты клиента; доска показывает итоги с разбивкой по валютам.

**Tech Stack:** Drizzle/Neon, Next.js 16, shadcn.

**Verification:** тест-раннера нет — `corepack pnpm exec tsc --noEmit` + `corepack pnpm lint` + `corepack pnpm build` + ручное.

**⚠️ Миграция БД** — контроллер, после подтверждения (не субагент).

**Подтверждённые факты:** `client` не имеет `currency`. `ClientRow` (`@/server/clients`) — без currency. `createClient(data)`, `updateClient(id, data)` — добавить currency. `/api/clients` POST/PUT destructure включает name/funnelPhase/status → добавить currency. `DealClientOption` (`@/server/deals`) = `{id,name}`, `listDealClientOptions` селектит `{id,name}`. `createDeal` имеет `clientId`. `CURRENCY_SYMBOL` в `@/lib/deal-board`. `organization.currency` в схеме main НЕТ (есть только в БД — дропнем).

---

## Task 1: Схема
**Files:** `src/db/schema.ts`
- [ ] **Step 1:** В таблицу `client` добавить `currency: text("currency").notNull().default("RUB"),` (рядом с прочими text-полями).
- [ ] **Step 2:** У `deal` поменять дефолт валюты: `currency: text("currency").notNull().default("USD")` → `default("RUB")`.
- [ ] **Step 3:** `corepack pnpm exec tsc --noEmit`.
- [ ] **Step 4: Commit**
```
git add src/db/schema.ts
git commit -m "feat(db): валюта расчётов у клиента (client.currency); дефолт сделки RUB"
```
- [ ] **Step 5: МИГРАЦИЯ — контроллер, после подтверждения.** Идемпотентно:
  `ALTER TABLE client ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'RUB';`
  `ALTER TABLE organization DROP COLUMN IF EXISTS currency;`
  `ALTER TABLE deal ALTER COLUMN currency SET DEFAULT 'RUB';`

---

## Task 2: Серверный слой клиента + сделки
**Files:** `src/server/clients.ts`, `src/app/api/clients/route.ts`, `src/server/deals.ts`
- [ ] **Step 1:** `ClientRow` (clients.ts): добавить `currency: string`. В select-маппинге, который строит ClientRow, добавить `currency: <row>.currency` (найти, где собирается ClientRow из строки `client`).
- [ ] **Step 2:** `createClient(data)`: добавить `currency?: string` в тип data; при insert ставить `currency: data.currency ?? "RUB"`. `updateClient`: добавить `currency?: string`; если `currency !== undefined` — писать в patch.
- [ ] **Step 3:** `/api/clients` route: в POST и PUT добавить `currency` в деструктуризацию `body` и передавать в `createClient`/`updateClient`.
- [ ] **Step 4:** `DealClientOption` (deals.ts): добавить `currency: string`. В `listDealClientOptions` select добавить `currency: client.currency`.
- [ ] **Step 5:** `createDeal` (deals.ts): валюта сделки = валюта клиента. Перед insert:
```ts
  const clientRow = await db
    .select({ currency: client.currency })
    .from(client)
    .where(eq(client.id, data.clientId))
    .limit(1)
  const currency = clientRow[0]?.currency ?? "RUB"
```
и вставлять `currency`. (Если в createDeal уже есть `const currency = ...` — заменить им. `updateDeal` валюту не трогает.)
- [ ] **Step 6:** `corepack pnpm exec tsc --noEmit` + `corepack pnpm lint`.
- [ ] **Step 7: Commit**
```
git add src/server/clients.ts src/app/api/clients/route.ts src/server/deals.ts
git commit -m "feat(server): валюта клиента в ClientRow/опциях; сделка берёт валюту клиента"
```

---

## Task 3: Форма клиента — «Валюта расчётов»
**Files:** `src/components/forms/form-client-edit.tsx`
- [ ] **Step 1:** Прочитать файл (react-hook-form + zod; поля name/funnelPhase/status; submit в `/api/clients`).
- [ ] **Step 2:** Добавить `currency: string` в тип формы/zod, в `defaultValues` и `form.reset({...})` со значением `client?.currency ?? "RUB"`.
- [ ] **Step 3:** UI — `Select` «Валюта расчётов» (опции value=код / label со значком: `₽ RUB, $ USD, € EUR, £ GBP, ¥ CNY`), по образцу других полей формы. `Select*` из `@/components/ui/select` (импортировать при необходимости).
- [ ] **Step 4:** В submit-payload (объекты для POST/PUT) добавить `currency: data.currency`.
- [ ] **Step 5:** `corepack pnpm exec tsc --noEmit` + `corepack pnpm lint`.
- [ ] **Step 6: Commit**
```
git add src/components/forms/form-client-edit.tsx
git commit -m "feat: «Валюта расчётов» в форме клиента"
```

---

## Task 4: Форма сделки — «Сумма» со значком валюты клиента
**Files:** `src/components/forms/form-deal-edit.tsx`
- [ ] **Step 1:** Прочитать файл. У формы есть селект клиента (`name="clientId"`, watched), список клиентов `clientOptions` (тип `DealClientOption`, теперь с `currency`), поле «Сумма» (`name="value"`).
- [ ] **Step 2:** Импортировать `CURRENCY_SYMBOL` из `@/lib/deal-board`. Вычислить валюту выбранного клиента:
```ts
  const selectedClient = clientOptions.find((c) => c.id === watchedClientId)
  const currencySymbol =
    CURRENCY_SYMBOL[(selectedClient?.currency ?? "RUB").toUpperCase()] ??
    (selectedClient?.currency ?? "RUB")
```
(используй фактические имена переменных watched/clientOptions из файла.)
- [ ] **Step 3:** «Сумма» со значком-префиксом:
```tsx
<div className="relative">
  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
    {currencySymbol}
  </span>
  <Input className="pl-7" placeholder="0" {...field} />
</div>
```
(адаптировать под текущую разметку поля «Сумма», сохранив validation/props.)
- [ ] **Step 4:** `corepack pnpm exec tsc --noEmit` + `corepack pnpm lint`.
- [ ] **Step 5: Commit**
```
git add src/components/forms/form-deal-edit.tsx
git commit -m "feat: «Сумма» со значком валюты выбранного клиента"
```

---

## Task 5: Доска — итоги с разбивкой по валютам
**Files:** `src/lib/deal-board.ts`, `src/components/blocks/deals-board.tsx`
- [ ] **Step 1:** В `deal-board.ts` добавить хелпер (и оставить `formatAggregate` как есть либо удалить после замены всех вызовов — см. шаг 2):
```ts
// Группировка сумм по валютам → строка вида "1 200 000 ₽ · 30 000 $".
export function aggregateByCurrency(
  entries: { amount: number; currency: string }[],
): string {
  const byCur = new Map<string, number>()
  for (const e of entries) {
    byCur.set(e.currency, (byCur.get(e.currency) ?? 0) + e.amount)
  }
  const parts = Array.from(byCur.entries())
    .filter(([, n]) => Math.round(n) !== 0)
    .map(([cur, n]) => {
      const symbol = (CURRENCY_SYMBOL[cur.toUpperCase()] ?? cur).trim()
      return `${Math.round(n).toLocaleString("ru-RU")} ${symbol}`
    })
  return parts.length ? parts.join(" · ") : "0 ₽"
}
```
- [ ] **Step 2:** В `deals-board.tsx` заменить все `formatAggregate(...)` на разбивку по валютам:
  - **Шапка (прогноз):** вместо `formatAggregate(forecast)` — построить entries из активных нетерминальных сделок: `aggregateByCurrency(activeDeals.filter(d => !isTerminalStage(d.funnelStageName)).map(d => ({ amount: dealAmount(d.value) * (probByStageId.get(d.funnelStageId) ?? d.funnelStageProbability), currency: d.currency })))`. (Нужна карта вероятностей по стадии — можно собрать из `stages`.)
  - **`Column`:** сумма колонки = `aggregateByCurrency(deals.map(d => ({ amount: dealAmount(d.value), currency: d.currency })))`; взвешенная = `aggregateByCurrency(deals.map(d => ({ amount: dealAmount(d.value) * stage.closureProbability, currency: d.currency })))`. (`deals` — сделки колонки, `stage.closureProbability` доступен.)
  - **Терминальная полка:** сумма = `aggregateByCurrency(items.map(d => ({ amount: dealAmount(d.value), currency: d.currency })))`.
  - Импортировать `aggregateByCurrency` (и убрать `formatAggregate`/проп `currency`, если он был — на main его в доске нет, пропа currency нет; ничего лишнего не вводить).
  - `weightedForecast` (число) больше не нужен в шапке — заменён разбивкой; если станет неиспользуемым, убрать импорт (tsc/lint поймают).
- [ ] **Step 3:** `corepack pnpm exec tsc --noEmit` → без ошибок; `corepack pnpm build` → EXIT 0.
- [ ] **Step 4: Commit**
```
git add src/lib/deal-board.ts src/components/blocks/deals-board.tsx
git commit -m "feat: итоги доски сделок с разбивкой по валютам"
```

---

## Self-review
- client.currency + дефолты (T1), сервер клиента/сделки (T2), форма клиента (T3), «Сумма» по валюте клиента (T4), разбивка по валютам на доске (T5), миграция (T1 step5 + дроп org.currency).
- Карточка/drawer: `formatAmount(deal.value, deal.currency)` — без доработок.
- Без тест-раннера: tsc/lint/build + ручное.
