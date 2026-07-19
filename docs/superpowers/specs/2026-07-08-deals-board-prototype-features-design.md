# Deals Board — перенос фич прототипа `deal-kanban_1.html`

Дата: 2026-07-08
Статус: одобрено (design), в реализации

## Цель

Внедрить в текущую доску сделок (`/deals`) все фичи из прототипа
`deal-kanban_1.html`. Отсутствующий бэкенд — **замокать за API-роутами** с
комментариями `TODO(backend)` для разработчика.

## Решения (зафиксированы с пользователем)

1. **Визуал** — адаптировать под приложение: фичи прототипа на существующих
   shadcn/Tailwind компонентах и токенах темы (ember-primary уже совпадает),
   иконки lucide, поддержка светлой и тёмной темы. Не bespoke dark-порт.
2. **Мок** — новые API-роуты, отдающие детерминированный мок на основе реальных
   сделок; замена на реальную ручку = только тело роута.
3. **Интеграция** — обновляем текущую `/deals` in place, сохраняя рабочие части
   (DnD-перевод с персистом, drawer сделки, фильтры, поиск, «Найти в источниках»).

## Подход

Слоёная интеграция: сохраняем каркас `deals-board.tsx`, навешиваем фичи
изолированными модулями + мок-роутами. Один серверный модуль-контракт
`deals-mock.ts` — источник всех мок-типов и генераторов.

## Граница «реальное / мок»

| Фича | Данные |
|---|---|
| Перевод стадии + note; прогноз; суммы; мультивалюта; терминальная полка; toast защиты | **реальные** (есть) |
| Следующий шаг + инвариант «нет шага» | **реальный** — ближайшая открытая задача по `dealId`/`dueDate` (`/api/tasks`) |
| Провенанс: Изменение/Обоснование/автор/дата | **реальные** (`changes`/`reasoning`/`userName`/`updatedAt`) |
| Провенанс: Источник-ссылка + Confidence | мок (`intel`) |
| Предложения агента (ghost) | мок-роут `/api/deals/proposals` |
| Лента решений | мок-роут `/api/deals/feed` |
| Остывание + нормы стадий | мок (`intel`); дни из `updatedAt` |
| Коммитменты стадий (чек-лист) | мок-конфиг по имени стадии (`intel`) |
| Бейджи-таксономия + lock-поля | мок (`intel`) |

## Мок-контракт (`src/server/deals-mock.ts`)

Детерминированные генераторы (ключ = стабильный hash от `dealId`), in-memory
store для аппендов ленты/отклонений (живёт в процессе dev-сервера). Весь модуль
помечен `TODO(backend)`. Экспортируемые типы (форму сохранить при реализации
реального бэкенда):

```ts
type DealProposal = {
  id: string; dealId: string
  fromStageId: string; toStageId: string
  fromLabel: string; toLabel: string
  direction: "fwd" | "back"
  why: string; source: string; confidence: "low" | "medium" | "high"
}
type FeedEvent = {
  id: string; actor: string; isAI: boolean
  at: string; html: string   // безопасный текст-разметка события
}
type DealIntel = {
  staleDays: number; norm: number; isStale: boolean
  badges: { kind: "source" | "ai" | "auto" | "lock"; icon: string; text: string }[]
  provenanceSource: string | null
  confidence: "low" | "medium" | "high" | null
  locks: ("amount" | "stage")[]
}
type StageCommitments = Record<string /* stageId */, string[]>
```

Нормы и коммитменты маппятся на **реальные** имена стадий приложения
(Qualification, Discovery, Pilot, Proposal, Negotiations) — не на англ. id
прототипа.

## Роуты (мок)

- `GET /api/deals/proposals` → `DealProposal[]` по активным сделкам орги.
- `POST /api/deals/proposals` `{id, action:"accept"|"reject", reason?}` →
  accept: реальный `moveDealStage` + событие ленты; reject: событие + сохранение
  причины (in-memory) `TODO(backend)`.
- `GET /api/deals/feed` → `FeedEvent[]` (сид из реальных `changes` + мок-события
  агента + аппенды).
- `GET /api/deals/intel` → `{ intel: Record<dealId, DealIntel>, commitments: StageCommitments }`.

Каждый роут: auth через существующий паттерн (`getServerSession` / реюз
`listDeals`), в шапке — `TODO(backend): здесь должна быть ручка …` с описанием.

## Компоненты

- `deals-board.tsx` — чип «Предложения агента N», тоггл «Лента решений»,
  slim-колонки для пустых стадий, превью коммитмента в шапке колонки, монтаж
  ghost-карточек и drawer ленты.
- `deal-kanban-card.tsx` — строка «следующий шаг» + инвариант; бейдж остывания с
  popover; бейджи-таксономия; приглушение при активном предложении.
- `deal-provenance.tsx` — + Источник (ссылка) + Confidence.
- `deal-proposal-ghost.tsx` (new) — пунктирная карточка предложения, Принять/Отклонить.
- `deal-decision-feed.tsx` (new) — выдвижная панель ленты (Sheet/боковая колонка).
- `deal-move-dialog.tsx` — чек-лист коммитментов стадии (вперёд, ≥1 галочка
  разблокирует кнопку), обязательное основание (назад).
- `use-board-intel.ts` (new hook) — параллельный fetch proposals/feed/intel/tasks,
  рефетч после мутаций.

## Тестирование

- Юнит: детерминизм генераторов; `staleDays`/invariant; маппинг коммитментов на
  реальные стадии; `moveDirection`.
- Компонентные: ghost accept/reject, чек-лист гейтит кнопку, slim-колонки,
  инвариант без задач.
- E2E: прогон живой доски (`/run`) + скриншот.

## Явно вне scope

- Реальный движок предложений агента, журнал событий в БД, конфиг норм/
  коммитментов в настройках орги, структурированный origin/locks на сделке —
  всё помечено `TODO(backend)` в мок-слое.
