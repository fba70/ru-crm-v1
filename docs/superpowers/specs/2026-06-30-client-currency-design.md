# Валюта расчётов на уровне клиента — дизайн

Дата: 2026-06-30
Статус: одобрено к реализации
Ветка: `feature/client-currency`

## Контекст
Ранее валюту пытались сделать свойством организации (ветка `feature/org-currency`,
**не смержена**). Заказчик передумал: валюта — это **«валюта расчётов» конкретного
клиента**. Org-вариант отменён; в БД осталась осиротевшая `organization.currency`
(в схеме `main` её нет) — дропнем в миграции.

## Модель
- Колонка `currency` на **client** (text, NOT NULL, default `RUB`) — «валюта расчётов».
- Сделка берёт валюту своего клиента: `createDeal` ставит `deal.currency` = валюта
  клиента (по `clientId`). Снимок на момент создания; смена валюты клиента влияет на
  новые сделки. `updateDeal` валюту не меняет.
- `deal.currency` schema default: `USD` → `RUB` (косметика; createDeal всё равно ставит явно).

## UI
- **Форма клиента (`form-client-edit`):** select «Валюта расчётов» (₽ RUB, $ USD, € EUR,
  £ GBP, ¥ CNY). Значение из `client.currency` (fallback RUB). Передаётся в `/api/clients`.
- **Форма сделки (`form-deal-edit`):** «Сумма» — со значком валюты **выбранного клиента**.
  Валюту клиента форма знает из опций клиента (в `DealClientOption` добавляем `currency`);
  при смене клиента значок обновляется. Поля выбора валюты в сделке нет.
- **Отображение сумм** карточка/drawer — `formatAmount(deal.value, deal.currency)` (валюта
  сделки = валюта клиента), без доработок.

## Доска — итоги с разбивкой по валютам
Сделки могут быть в разных валютах. Хелпер `aggregateByCurrency(entries)` группирует суммы
по валютам и форматирует строкой `«1 200 000 ₽ · 30 000 $»`. Применяется к:
- взвешенному прогнозу в шапке (сумма value×prob по активным нетерминальным, сгруппировано
  по валюте сделки);
- суммам/взвешенным в заголовке колонки;
- терминальной полке.
(`formatAggregate(n)` — убираем/заменяем на `aggregateByCurrency`.)

## Серверный слой
- `client` create/update (`@/server/clients` или где они) принимают `currency`.
- `ClientRow` включает `currency` (для формы клиента).
- `DealContactOption`… нет — `DealClientOption` (`@/server/deals`) включает `currency`.
- `createDeal`: `deal.currency` = валюта клиента по `clientId` (lookup `client.currency`).

## Миграция (контроллер, после подтверждения)
1. `ALTER TABLE client ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'RUB';`
2. `ALTER TABLE organization DROP COLUMN IF EXISTS currency;` (осиротевшая).
3. (опц.) `ALTER TABLE deal ALTER COLUMN currency SET DEFAULT 'RUB';`
Существующие сделки уже в RUB (нормализованы ранее), клиенты по умолчанию RUB — данные
консистентны.

## Не входит
- Пересчёт по курсам/FX.
- Список разрешённых валют (один справочник в Select).

## Тестирование
Тест-раннера нет — `tsc --noEmit` + `lint` + `build` + ручное (валюта клиента сохраняется;
новая сделка берёт валюту клиента; «Сумма» со значком клиента; разбивка по валютам на доске).
