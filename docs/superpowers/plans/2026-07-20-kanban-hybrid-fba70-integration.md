# Интеграция fba70/design + гибрид канбана — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Объединить форки `GregNBlack/ru-crm-v1` (наш) и `fba70/ru-crm-v1` (Бориса), собрать гибрид канбана (наш продукт/дизайн + механики Бориса) и прямым пушем залить результат в `fba70/design`, ничего не потеряв с обеих сторон.

**Architecture:** Отдельная ветка `integrate/fba70-design` от нашего `feature/client-currency`. Сначала «приземляем» merge `fba70/design` с union-разрешением конфликтов, оставляя НАШ board как есть (его `deals-kanban/` не берём) — так дерево собирается. Затем отдельными коммитами прививаем механики Бориса в наш board. В конце — миграция боевой БД (с подтверждением) и прямой пуш в `fba70/design`.

**Tech Stack:** Next.js 16 (Turbopack), React, TypeScript, drizzle-kit + Neon (Postgres), @dnd-kit/core, pnpm (via corepack), Vitest (если настроен) / точечные скрипты для логики.

## Global Constraints

- Рабочая директория: `/Users/greore/Documents/Margo/project/ru-crm-v1`. pnpm только через `corepack pnpm <cmd>`.
- Цель пуша — **`fba70/design`**, прямой пуш merge-коммита, **без PR**.
- `.env` (Neon/OAuth/Polar/Resend/R2/Telegram) НИКОГДА не коммитить (`.gitignore: .env*`). Секреты — чувствительные.
- Любой `drizzle-kit push` меняет **боевую Neon** → только после явного подтверждения пользователя на шаге миграции. При ПДн помнить про 152-ФЗ.
- Развилка move (согласована): внутри колонки → оптимистично `moveOnly+position` без диалога; между стадиями → наш `DealMoveDialog` с заметкой + проставить `position` (append в конец целевой колонки).
- Ничего не терять: наш продукт/агент/дизайн + все механики Бориса (reorder/sort/collapse/optimistic/keyboard/a11y) + все его 28 коммитов фич.
- Коммиты частые, сообщения на русском, с `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Фаза 1. Приземление merge (union, наш board сохраняем)

### Task 0: Зафиксировать pending-правки на feature/client-currency

**Files:** untracked/modified из `git status` (board-фичи, брендинг salesdaily, прочее).

- [ ] **Step 1:** Осмотреть незакоммиченное: `git status -sb` и `git diff --stat`.
- [ ] **Step 2:** Сгруппировать и закоммитить логически (не одним свалочным коммитом). Ориентир:
  - board-фичи: `src/server/deals-mock.ts`, `src/hooks/use-board-intel.ts`, `src/app/api/deals/{feed,intel,proposals}/`, `src/components/blocks/{deal-decision-feed,deal-proposal-ghost}.tsx`, изменённые `deals-board.tsx`, `deal-kanban-card.tsx`, `deal-move-dialog.tsx`, `deal-provenance.tsx`.
  - брендинг: `public/sd-*.svg`, `public/salesdaily.svg`, `src/components/blocks/{brand-logo,brand-mark}.tsx`, изменённые `layout.tsx`, `globals.css`, `home-content.tsx`, `app-sidebar.tsx`, `(protected)/layout.tsx`.
  - прочее: `client-detail-shell.tsx`, `client-content.ts`, `ai-chat.tsx`.
  ```bash
  git add src/server/deals-mock.ts src/hooks/use-board-intel.ts "src/app/api/deals/feed" "src/app/api/deals/intel" "src/app/api/deals/proposals" src/components/blocks/deal-decision-feed.tsx src/components/blocks/deal-proposal-ghost.tsx src/components/blocks/deals-board.tsx src/components/blocks/deal-kanban-card.tsx src/components/blocks/deal-move-dialog.tsx src/components/blocks/deal-provenance.tsx
  git commit -m "feat(board): предложения агента, лента решений, board-intel"
  # затем брендинг и прочее аналогичными коммитами
  ```
- [ ] **Step 3:** Убедиться, что дерево чистое: `git status --porcelain` → пусто.
- [ ] **Step 4 (verify):** `corepack pnpm build` — собирается (базовая линия ДО merge).
  Expected: build OK.

### Task 1: Интеграционная ветка + остановить dev

**Files:** —

- [ ] **Step 1:** Остановить фоновый dev-сервер `b84jkd0ix` (иначе Turbopack спамит на полу-слитых файлах).
- [ ] **Step 2:** `git switch -c integrate/fba70-design`
- [ ] **Step 3 (verify):** `git branch --show-current` → `integrate/fba70-design`; `git status` чисто. Remote `fba70` уже добавлен и зафетчен (проверить `git remote -v`).

### Task 2: Начать merge, разрешить package.json + lockfile

**Files:** `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1:** `git merge fba70/design --no-ff --no-commit` (ожидаемо остановится на конфликтах).
- [ ] **Step 2:** `git status` — зафиксировать полный список конфликтов (сверить со spec).
- [ ] **Step 3:** `package.json` — вручную объединить `dependencies`/`devDependencies`/`scripts` обеих сторон (union; при разнице версий — брать более новую, помечая на потом). Разрешить конфликт-маркеры.
- [ ] **Step 4:** Перегенерировать лок: удалить конфликтный `pnpm-lock.yaml` из индекса и пересобрать — `corepack pnpm install` (перепишет `pnpm-lock.yaml` под объединённый `package.json`).
- [ ] **Step 5 (verify):** `git diff --check` по этим двум файлам — нет маркеров `<<<<`. `corepack pnpm install` завершился без ошибок.

### Task 3: Разрешить src/db/schema.ts (union + индекс)

**Files:** `src/db/schema.ts`

- [ ] **Step 1:** Открыть конфликты. Правило: сохранить ВСЕ таблицы/колонки обеих сторон. Наши (валюты, board-поля) + его (blocklist, products enrich, telegram-источники и т.д.).
- [ ] **Step 2:** Убедиться, что присутствует его индекс сделок: `index("deal_stage_position_idx").on(table.funnelStageId, table.position)` и колонка `position: text("position")` в таблице deals (у нас колонка уже есть — не дублировать).
- [ ] **Step 3:** Снять все маркеры конфликта.
- [ ] **Step 4 (verify):** `git diff --check src/db/schema.ts` чисто; `corepack pnpm exec tsc --noEmit` не даёт ошибок именно по schema (полный tsc может ругаться на ещё не разрешённые файлы — фокус на schema).

### Task 4: Разрешить API/сервер сделок (наш move+note И его moveOnly+position)

**Files:** `src/app/api/deals/route.ts`, `src/server/deals.ts`

- [ ] **Step 1:** В `route.ts` PUT-обработчике сохранить ОБА пути: наш `move:true` (+`note`) и его `moveOnly:true` (+`position`, валидация «position required»). Оба должны уметь принимать `position`.
- [ ] **Step 2:** В `DealRow` (тип и select-маппинг) добавить поле `position` (из его версии).
- [ ] **Step 3:** В `server/deals.ts` сохранить наши функции (перевод с заметкой/логом) и его `moveDeal({ funnelStageId, position })`. Не терять ни бизнес-лог заметки, ни persist позиции.
- [ ] **Step 4 (verify):** маркеров нет; `corepack pnpm exec tsc --noEmit` по этим файлам без ошибок.

### Task 5: Разрешить layout / clients page / form-deal-edit (union по хункам)

**Files:** `src/app/(protected)/layout.tsx`, `src/app/(protected)/clients/page.tsx`, `src/components/forms/form-deal-edit.tsx`

- [ ] **Step 1:** По каждому — объединить хунки: наши изменения (брендинг/валюты/поповер инициатора) + его (enrich-контролы, новые поля). Где строки независимы — брать обе.
- [ ] **Step 2 (verify):** маркеров нет; `tsc --noEmit` по этим файлам чисто.

### Task 6: deal-card.tsx (modify/delete) + не брать его deals-kanban/

**Files:** `src/components/blocks/deal-card.tsx` (наша сторона — удалён), `src/components/blocks/deals-kanban/*` (его новые)

- [ ] **Step 1:** Найти всех потребителей его `DealCard`: `git grep -n "blocks/deal-card" -- '*.tsx' '*.ts'` в состоянии merge.
- [ ] **Step 2:** Разрешить modify/delete в пользу удаления: `git rm src/components/blocks/deal-card.tsx`.
- [ ] **Step 3:** Его папку `src/components/blocks/deals-kanban/` НЕ включаем в дерево (её роль займёт наш гибрид в фазе 2). Если merge её принёс — `git rm -r src/components/blocks/deals-kanban/`. Оставить только `deals-kanban/` из наших будущих файлов (пока пусто).
- [ ] **Step 4:** Починить оставшиеся импорты `DealCard`/`deals-kanban`, которые пришли из его кода вне канбана (переключить на наши компоненты или удалить неиспользуемое). Роут доски (`(protected)/deals/page.tsx`) должен рендерить наш `DealsBoard`.
- [ ] **Step 5 (verify):** `git grep -n "blocks/deal-card\|blocks/deals-kanban"` → только осмысленные (наши) ссылки; `tsc --noEmit` чисто по затронутым.

### Task 7: Завершить merge-коммит (дерево собирается с нашим board)

**Files:** все разрешённые

- [ ] **Step 1:** `git add -A` разрешённых файлов; убедиться, что не осталось `UU`/`DU`/`AA`: `git status --porcelain | grep -E "^(U|.U|AA|DD)"` → пусто.
- [ ] **Step 2:** `corepack pnpm build` — **вся** сборка проходит (его фичи-страницы products/rules/settings/tasks/blocklist/enrichment + наш board вместе).
  Expected: build OK. Если падает — чинить импорты/типы до зелёного.
- [ ] **Step 3:** `git commit` (завершает merge). Сообщение: `merge: fba70/design в наш форк (union; наш board сохранён)`.
- [ ] **Step 4 (verify):** `git log --oneline -1` показывает merge-коммит; `git status` чисто.

---

## Фаза 2. Гибрид канбана (прививаем механики Бориса в наш board)

Референс механик — выгруженные файлы Бориса в scratchpad: `.../scratchpad/fba70-kanban/{store.ts,board.tsx,column.tsx,rail.tsx,card.tsx}`. Также `git show fba70/design:src/lib/kanban-move.ts`.

### Task 8: lib/kanban-move.ts + подтверждение position в API

**Files:**
- Create: `src/lib/kanban-move.ts`
- Verify: `src/app/api/deals/route.ts`, `src/server/deals.ts` (position уже подключён в Task 4)

**Interfaces:**
- Produces: `computePosition(before: string | null, after: string | null): string` — дробный индекс между соседями; бросает при неупорядоченных ключах.

- [ ] **Step 1:** Взять его файл: `git show fba70/design:src/lib/kanban-move.ts > src/lib/kanban-move.ts`.
- [ ] **Step 2: Написать падающий тест** `src/lib/__tests__/kanban-move.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest"
  import { computePosition } from "@/lib/kanban-move"
  describe("computePosition", () => {
    it("между null,null даёт валидный ключ", () => {
      expect(typeof computePosition(null, null)).toBe("string")
    })
    it("между a и b строго между по сравнению строк", () => {
      const a = computePosition(null, null)
      const b = computePosition(a, null)
      const mid = computePosition(a, b)
      expect(a < mid && mid < b).toBe(true)
    })
    it("append после последнего растёт", () => {
      const a = computePosition(null, null)
      const b = computePosition(a, null)
      expect(a < b).toBe(true)
    })
  })
  ```
- [ ] **Step 3: Прогнать, убедиться что падает (или проходит сразу)** `corepack pnpm exec vitest run src/lib/__tests__/kanban-move.test.ts`. Если vitest не настроен — вынести проверку в одноразовый `tsx`-скрипт и удалить после.
  Expected: тесты зелёные (импортируем готовую реализацию Бориса).
- [ ] **Step 4 (verify):** тесты проходят; `tsc --noEmit` по файлу чисто.
- [ ] **Step 5: Commit** `git add src/lib/kanban-move.ts src/lib/__tests__/kanban-move.test.ts && git commit -m "feat(kanban): дробный индекс позиции (перенос из fba70) + тесты"`

### Task 9: deals-kanban/store.ts — хук состояния доски

**Files:**
- Create: `src/components/blocks/deals-kanban/store.ts`
- Test: `src/components/blocks/deals-kanban/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `computePosition` (Task 8), наш `DealRow`, `DealFunnelStageOption` из `@/app/api/deals/route`.
- Produces:
  - `type SortMode = "manual" | "value" | "newest" | "oldest"`; `SORT_MODES`, `SORT_LABEL`.
  - `useBoardStore({ deals, stages, onChanged, boardId }) → { columns, collapsed, toggleCollapse, expand, collapseStage, setSort, move, dealById }`.
  - `move(dealId, toStageId, beforeId, afterId, targetMode)` — оптимистичный reorder внутри стадии (persist `moveOnly+position`). Кросс-стейт move ОТДЕЛЬНО (через board + наш диалог), сюда не входит.
  - `sortCards(cards, mode)`, `compareManual(a,b)` — экспортировать для тестов.

- [ ] **Step 1:** Скопировать основу из его `store.ts` (scratchpad), адаптировать под НАШ `DealRow` (поля `value`, `currency`, `createdAt`, `updatedAt`, `position`, `funnelStageId/Name`, `status`).
- [ ] **Step 2: Тест** `sortCards`/`compareManual`:
  ```ts
  import { describe, it, expect } from "vitest"
  import { sortCards, compareManual } from "@/components/blocks/deals-kanban/store"
  const mk = (o: Partial<any>) => ({ id: "x", value: null, position: null, createdAt: "", updatedAt: "", ...o })
  describe("sortCards", () => {
    it("value: null-суммы вниз", () => {
      const r = sortCards([mk({id:"a",value:null}), mk({id:"b",value:"10"})], "value")
      expect(r.map(c=>c.id)).toEqual(["b","a"])
    })
    it("newest по createdAt убыв.", () => {
      const r = sortCards([mk({id:"a",createdAt:"2024"}), mk({id:"b",createdAt:"2025"})], "newest")
      expect(r[0].id).toBe("b")
    })
    it("manual: keyed раньше unkeyed", () => {
      const r = sortCards([mk({id:"a",position:null,updatedAt:"2024"}), mk({id:"b",position:"a0"})], "manual")
      expect(r[0].id).toBe("b")
    })
  })
  ```
- [ ] **Step 3:** Прогнать: `corepack pnpm exec vitest run .../store.test.ts` → зелёные.
- [ ] **Step 4 (verify):** `tsc --noEmit` по store чисто.
- [ ] **Step 5: Commit** `git commit -m "feat(kanban): store-хук (sort/collapse/optimistic move) на нашем DealRow + тесты"`

### Task 10: deals-kanban/rail.tsx — свёрнутая колонка

**Files:** Create `src/components/blocks/deals-kanban/rail.tsx`

**Interfaces:**
- Produces: `Rail({ stage, count, onExpand })` — droppable `col:<stageId>`, вертикальный лейбл, клик разворачивает.

- [ ] **Step 1:** Взять его `rail.tsx` из scratchpad как есть (зависимости — `@dnd-kit/core`, `dealStageLabel`, наш `DealFunnelStageOption` — совпадают).
- [ ] **Step 2 (verify):** `tsc --noEmit` по файлу чисто.
- [ ] **Step 3: Commit** `git commit -m "feat(kanban): рельса свёрнутой колонки (перенос из fba70)"`

### Task 11: deals-kanban/column.tsx — гибрид (его хром + наш контент)

**Files:** Create `src/components/blocks/deals-kanban/column.tsx`

**Interfaces:**
- Consumes: `BoardColumn`, `SortMode`, `SORT_MODES`, `SORT_LABEL` (Task 9); наш `DealKanbanCard`; наши агрегаторы `aggregateByCurrency`, `dealAmount` из `@/lib/deal-board`.
- Produces: `Column({ column, stages, ...ourProps, onCollapse, onSortChange })` — рендерит: его шапку (accent-бар, дропдаун сортировки, кнопка сворачивания) + НАШУ статистику стадии (count/сумма/взвеш./коммитмент) + список НАШИХ карточек `DealKanbanCard` (droppable-обёртка из Task 12) + ghosts + `hideDeals`.

- [ ] **Step 1:** Собрать из его `column.tsx` (хром) и нашего инлайн-`Column` из `deals-board.tsx:61-188` (контент: статистика, ghosts, hideDeals, коммитменты).
- [ ] **Step 2:** Droppable колонки `col:<stageId>` с `data:{type:"column",stageId}` (как у него).
- [ ] **Step 3 (verify):** `tsc --noEmit` по файлу чисто (карточка-обёртка из Task 12 может потребоваться — если так, поменять местами 11↔12).
- [ ] **Step 4: Commit** `git commit -m "feat(kanban): колонка-гибрид (хром fba70 + наша статистика/ghosts)"`

### Task 12: Обёртка карточки — droppable для точной вставки

**Files:** Modify `src/components/blocks/deal-kanban-card.tsx`

**Interfaces:**
- Produces: `DealKanbanCard` дополнительно `useDroppable({ id:"card:"+deal.id, data:{type:"card",stageId,dealId} })`. Drag остаётся на всей карточке; клик-vs-drag уже разведён `justDraggedRef` в board.

- [ ] **Step 1:** Добавить `useDroppable` рядом с существующим `useDraggable`, повесить `setDropRef` на корневой контейнер (не ломая существующий drag/onClick/onKeyDown).
- [ ] **Step 2 (verify):** `tsc --noEmit` по файлу чисто.
- [ ] **Step 3: Commit** `git commit -m "feat(kanban): карточка как droppable (точная вставка before/after)"`

### Task 13: board.tsx — сборка гибрида + развилка move

**Files:** Modify `src/components/blocks/deals-board.tsx` (вынести Column, подключить store/rail/column, collision, keyboard, a11y)

**Interfaces:**
- Consumes: `useBoardStore` (Task 9), `Column` (Task 11), `Rail` (Task 10), обёрнутая `DealKanbanCard` (Task 12).

- [ ] **Step 1:** Заменить наш инлайн-`Column` на импорт из `deals-kanban/column.tsx`; удалить дублирующий локальный код.
- [ ] **Step 2:** Ввести `useBoardStore({ deals: boardDeals, stages, onChanged, boardId })`; рендерить `collapsed[stage.id] ? <Rail/> : <Column/>`.
- [ ] **Step 3:** DnD как у него: `collisionDetection` (card→column fallback), `PointerSensor` (distance 6) + `KeyboardSensor`, `accessibility.announcements`.
- [ ] **Step 4: Развилка move в `onDragEnd`:**
  - вычислить `toStageId`, `beforeId/afterId` (его логика card-level).
  - если `toStageId === активная стадия карточки` → `store.move(...)` (оптимистично, без диалога).
  - если стадия меняется → НАШ путь: открыть `DealMoveDialog` (`setPendingMove`), а в `confirmMove` дополнительно вычислить `position` (append в конец целевой колонки через `computePosition(lastKeyed, null)`) и слать в `PUT` вместе с `note`.
  - терминальные стадии — прежняя защита (toast, без перевода).
- [ ] **Step 5:** Сохранить весь наш верхний слой без изменений: шапка/прогноз, фильтры, «Предложения агента», «Лента решений», drawer, терминальные стадии, discover.
- [ ] **Step 6 (verify — ручной, критичный):** `corepack pnpm dev`, открыть доску:
  - reorder внутри колонки (мгновенно, порядок сохраняется после refresh);
  - смена стадии → появляется наш диалог с заметкой, после подтверждения карточка на месте;
  - сортировка колонки (Вручную/Сумма/Новые/Старые);
  - сворачивание/разворачивание колонки, память после reload; drop на рельсу разворачивает;
  - клавиатура: Tab на карточку, Space/стрелки двигают, анонсы читаются;
  - предложения агента (ghost accept/reject), лента решений, drawer — не сломаны.
- [ ] **Step 7: Commit** `git commit -m "feat(kanban): гибрид — наш board + механики fba70; развилка move (reorder оптимистично / стадия через диалог)"`

---

## Фаза 3. Миграция, проверка, пуш

### Task 14: Миграция боевой БД (индекс + бэкфилл position) — С ПОДТВЕРЖДЕНИЕМ

**Files:** `src/db/schema.ts` (индекс уже в Task 3)

- [ ] **Step 1: STOP — запросить явное подтверждение пользователя.** `drizzle-kit push` меняет боевую Neon. Показать, что применится (индекс `deal_stage_position_idx`; бэкфилл `position` существующим сделкам).
- [ ] **Step 2:** Бэкфилл: проставить `position` сделкам, где `NULL`, в порядке `updatedAt` внутри каждой `funnelStageId` (одноразовый скрипт `tsx` или SQL). Показать SQL пользователю до выполнения.
- [ ] **Step 3:** `corepack pnpm drizzle-kit push` — применить индекс.
- [ ] **Step 4 (verify):** доска: reorder сохраняется в БД (проверить после hard reload, что порядок из БД). Индекс есть (`\d deals` / drizzle introspect).

### Task 15: Полная проверка сборки и клик-тест

- [ ] **Step 1:** `corepack pnpm install && corepack pnpm build` — зелёно.
- [ ] **Step 2:** `corepack pnpm lint` — без новых ошибок.
- [ ] **Step 3:** dev-прокликать: наш board (все механики из Task 13/Step 6) + хотя бы по одной его новой странице (products/rules/settings/tasks/blocklist/enrichment) открываются без ошибок.
- [ ] **Step 4:** `git status` чисто; все коммиты на месте (`git log --oneline fba70/design..HEAD`).

### Task 16: Прямой пуш в fba70/design

- [ ] **Step 1: STOP — подтвердить пуш** (операция «наружу», в чужую ветку). Показать `git log --oneline fba70/design..HEAD` — что именно уедет.
- [ ] **Step 2:** `git push fba70 integrate/fba70-design:design`
- [ ] **Step 3 (verify):** `git fetch fba70 && git log --oneline -3 fba70/design` — наш merge-коммит на вершине `fba70/design`. `git rev-list --count fba70/design..integrate/fba70-design` → 0.
- [ ] **Step 4:** Cleanup: убрать временный remote-probe/scratchpad при желании; сообщить пользователю итог.

---

## Self-Review (по spec)

- **Покрытие spec:** шаг 0 коммит pending — Task 0 ✓; интеграционная ветка — Task 1 ✓; union schema/API/layout/pages — Tasks 3–5 ✓; deal-card modify/delete + не брать его deals-kanban — Task 6 ✓; гибрид (store/column/rail/card/board + развилка move) — Tasks 8–13 ✓; миграция БД с подтверждением — Task 14 ✓; проверка — Task 15 ✓; прямой пуш в design — Task 16 ✓. Все механики Бориса из spec §«только у Бориса» покрыты (position/kanban-move — 8, sort/collapse/optimistic — 9, rail — 10, card droppable/collision/keyboard — 12/13). Наш слой из §«только у нас» сохраняется Tasks 11,13.
- **Плейсхолдеры:** merge-хунки описаны правилом+verify (точное содержимое неизвестно до merge — это осознанно, не TODO). Реальный код дан для тестов kanban-move/store и обвязки.
- **Согласованность типов:** `computePosition(before,after)`, `useBoardStore(...)→{columns,collapsed,toggleCollapse,expand,collapseStage,setSort,move,dealById}`, `SortMode`, `move(dealId,toStageId,beforeId,afterId,targetMode)` — используются одинаково в Tasks 8–13.
