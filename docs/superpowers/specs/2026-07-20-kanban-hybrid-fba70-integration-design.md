# Интеграция fba70/design + гибрид канбана

**Дата:** 2026-07-20
**Тип:** design / integration spec
**Ветки:** база — `feature/client-currency` (origin = `GregNBlack/ru-crm-v1`); цель — `fba70/design` (remote `fba70` = `git@github.com:fba70/ru-crm-v1.git`)

## Цель

Объединить два разошедшихся форка `ru-crm-v1` и залить результат прямым пушем в `fba70/design`, **ничего не потеряв ни у нас, ни у Бориса (fba70)**. Ядро работы — гибрид канбана сделок: наш продуктово-агентный слой и дизайн как база, механики Бориса (упорядочивание/сортировка/сворачивание/оптимистичный drag/клавиатура) привиты сверху.

## Исходное состояние (на 2026-07-20)

- `origin/main` ↔ `fba70/main`: наших коммитов сверх — 61, его — 28. Общий предок `9804a54 "RUBs"`.
- `fba70/main` и `fba70/design` идентичны (`790cd95`).
- Текущая ветка `feature/client-currency` — 73 коммита сверх `fba70/main`, плюс **незакоммиченные** правки: 12 изменённых файлов + ~15 новых (в т.ч. весь богатый board: `deals-mock.ts`, `use-board-intel.ts`, `deal-decision-feed.tsx`, `deal-proposal-ghost.tsx`, API `deals/feed|intel|proposals`, брендинг salesdaily).
- Конфликты merge `fba70/design` → наша ветка (по закоммиченному): `package.json`, `pnpm-lock.yaml`, `src/db/schema.ts`, `src/app/api/deals/route.ts`, `src/server/deals.ts`, `src/app/(protected)/clients/page.tsx`, `src/app/(protected)/layout.tsx`, `src/components/forms/form-deal-edit.tsx`, `src/components/blocks/deal-card.tsx` (modify/delete).

## Сравнение канбанов (обоснование гибрида)

**Только у Бориса (переносим):**
- Упорядочивание карточек внутри колонки — дробный индекс `position`, хелпер `src/lib/kanban-move.ts`, точная вставка before/after.
- Сортировка колонки: Вручную / По сумме / Новые / Старые (per-column, transient view-state).
- Сворачивание колонок в «рельсу» с сохранением в localStorage; авто-сворачивание опустевшей; drop на рельсу разворачивает.
- Оптимистичный drag с откатом (mirror `localDeals` + snapshot/revert).
- Клавиатурный DnD (`KeyboardSensor`) + ARIA-`announcements`.
- Card-level droppables + `collisionDetection` (card→column fallback).
- БД: индекс `deal_stage_position_idx` на `(funnelStageId, position)`; `position` в `DealRow`; API `moveOnly+position`.

**Только у нас (сохраняем):**
- Предложения агента (ghost-карточки, accept/reject, режим «только предложения»).
- Лента решений (`DealDecisionFeed`).
- Board intel: следующий шаг, коммитменты по стадии, инвариант «нет следующего шага».
- Взвешенный прогноз + мультивалютная агрегация.
- Фильтры: владелец (Все/Мои), клиент, поиск, отменённые/удалённые.
- Терминальные стадии: сводка + защита от перетаскивания.
- Drawer сделки, диалог перевода **с заметкой**, «Найти в источниках».
- Дизайн карточки — наш (`deal-kanban-card.tsx`).

**Замечание:** колонка `position` в `schema.ts` есть и у нас (стр. ~388), но не подключена. Борис довёл фичу до конца — переиспользуем его обвязку.

## Подход

**(A) Фазовый гибрид** — выбран. Отдельная интеграционная ветка, полное объединение обеих сторон, конфликты — union, канбан — гибрид. (B «всё одним коммитом» и C «force ours поверх design» отвергнуты: риск потерять поведение / затереть его 28 коммитов.)

## План

### Шаг 0 — зафиксировать наши правки
Закоммитить pending-изменения на `feature/client-currency` (иначе «наша версия» неполна). Логически сгруппировать (board-фичи, брендинг и т.д.).

### Шаг 1 — интеграционная ветка
`integrate/fba70-design` от текущего коммита `feature/client-currency`. `feature/client-currency` не трогаем. Dev-сервер (`b84jkd0ix`) на время merge гасим.

### Шаг 2 — merge и не-канбан конфликты (union)
Слить `fba70/design`. Его 28 коммитов преимущественно аддитивны (products, rules, settings, tasks, blocklist, client-enrichment, telegram-webhooks, admin-teardown) — вливаются целиком. Общие файлы решаем объединением:
- `schema.ts` — обе стороны таблиц/колонок + его индекс `deal_stage_position_idx`.
- `api/deals/route.ts`, `server/deals.ts` — наш `move+note` **и** его `moveOnly+position` сосуществуют; в `DealRow` добавить `position`.
- `layout.tsx`, `clients/page.tsx`, `form-deal-edit.tsx` — union по хункам.
- `package.json` — объединить зависимости; `pnpm-lock.yaml` перегенерить `pnpm install`.
- `deal-card.tsx` (modify/delete): остаётся удалённым у нас. Его `deals-kanban/*.tsx`, импортящие `DealCard`, не тащим. **Проверить**, не импортит ли `DealCard` что-то ещё у Бориса, и переключить на наш аналог/удалить.

### Шаг 3 — гибрид канбана
База — наши `deals-board.tsx` + `deal-kanban-card.tsx`. Разбить наш монолит по декомпозиции Бориса, порт механик:
- `deals-kanban/store.ts` — его хук (position-упорядочивание, sort-режимы, collapse, оптимистичный mirror+rollback), адаптирован под наш `DealRow` и фильтры.
- `deals-kanban/column.tsx` — его хром (accent, дропдаун сортировки, кнопка сворачивания) + наш контент (count/сумма/взвеш., коммитменты, ghosts, `hideDeals`).
- `deals-kanban/rail.tsx` — его свёрнутая колонка (заменяет наш «slim»), память в localStorage.
- Карточка — наша `DealKanbanCard` + `useDroppable` для точной вставки (drag на всей карточке; клик-vs-drag уже разведён `justDraggedRef`).
- `board.tsx` — его `collisionDetection`, `KeyboardSensor` + `announcements`, top-scrollbar; наш верхний слой (шапка, фильтры, предложения агента, лента решений, drawer, терминальные стадии).

**Move (ключевая развилка — согласована):**
- Внутри колонки (стадия не меняется) → оптимистично, мгновенно, без диалога: `PUT moveOnly+position`.
- Между колонками (смена стадии) → наш `DealMoveDialog` с заметкой; дополнительно проставляем `position` (append в конец целевой колонки), чтобы порядок оставался консистентным.

### Шаг 4 — миграция БД (боевая, с отдельным подтверждением)
Для рабочего упорядочивания: индекс `deal_stage_position_idx` + бэкфилл `position` существующим сделкам. Меняет **боевую Neon** → `drizzle-kit push` только после явного «да» на этом шаге.

### Шаг 5 — проверка и пуш
- `pnpm install` → `pnpm build` / `lint` → dev, прокликать доску: reorder, sort, collapse, cross-stage с заметкой, предложения агента, ленту решений.
- **Прямой пуш merge-коммита в `fba70/design`** (без PR — решение пользователя).

## Риски / вне области

- **Объём:** фактически объединяются два форка целиком — его products/telegram/blocklist/enrichment вливаются в наше дерево (иначе `design` не собрать). Не быстрая задача.
- **Боевая БД:** любой `drizzle-kit push` — только с подтверждением; при работе с ПДн помнить про 152-ФЗ.
- **Секреты:** `.env` (Neon/OAuth/Polar/Resend/R2/Telegram) в git не уходит — не коммитить.
- **Вне области:** переписывание его features под наш стиль; рефакторинг несвязанного кода; настройка CI.
