// Агент действует сам: предложения перевода стадии НЕ ждут подтверждения —
// GET (загрузка доски) сразу применяет каждое ожидающее предложение
// (`moveDealStage` с actor:'agent'), пишет событие в ленту решений и помечает
// сделку `lastMovedBy = 'agent'` (бейдж «перевёл агент» на карточке).
// Пользователь «отменяет» агентский перевод просто перетащив карточку —
// drag всегда разрешён и перезаписывает метку на 'user'.
//
// Гвард от «ползучести» мока: сделка с lastMovedBy === 'agent' пропускается —
// агент делает максимум ОДИН непересмотренный шаг; после ручного переноса
// (lastMovedBy = 'user') сделка снова становится eligible. Без гварда
// перезапуск сервера (in-memory resolved-set очищается) двигал бы те же
// сделки вперёд стадия за стадией.
//
// ГЕЙТ АВТОМАТИЗАЦИИ: агент двигает сделки ТОЛЬКО если у орги есть хотя бы
// один рабочий источник (`hasWorkingSource` — активный, с разрешённым
// автопарсингом и подключённый: секреты заполнены либо в upload-only
// источник уже что-то залито). Без источников автоматизации нет: маршрут
// возвращает { proposals: [], applied: 0 } и НИЧЕГО не пишет в БД. Иначе
// демо-орга без единого канала видит, как «система сама» тасует карточки.
// TODO(backend): заменить гейт на per-org настройки автоматизации.
//
// TODO(backend): генерация предложений — детерминированный мок
// (см. deals-mock.ts): ~каждая 3-я активная сделка по хэшу id, НЕ реальные
// сигналы из писем/TG. При реальном движке форма ответа сохраняется.
import { NextResponse } from "next/server"
import { listDealFunnelStages, moveDealStage } from "@/server/deals"
import { hasWorkingSource } from "@/server/sources"
import {
  requireMockOrg,
  loadBoardDeals,
  generateProposals,
  getResolvedProposals,
  markProposalResolved,
  appendFeedEvent,
} from "@/server/deals-mock"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message === "Deal not found"
        ? 404
        : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const { orgId } = await requireMockOrg()

    // Нет ни одного рабочего источника — агент молчит. Ничего не считаем и
    // ничего не пишем: форма ответа та же, что при «всё применено».
    if (!(await hasWorkingSource(orgId))) {
      return NextResponse.json({ proposals: [], applied: 0 })
    }

    const [deals, stages] = await Promise.all([
      loadBoardDeals(),
      listDealFunnelStages(),
    ])
    const proposals = generateProposals(
      deals,
      stages,
      getResolvedProposals(orgId),
    )
    const dealById = new Map(deals.map((d) => [d.id, d]))

    let applied = 0
    for (const p of proposals) {
      // Один непересмотренный агентский шаг на сделку (см. шапку файла).
      if (dealById.get(p.dealId)?.lastMovedBy === "agent") {
        markProposalResolved(orgId, p.id)
        continue
      }
      try {
        await moveDealStage(p.dealId, p.toStageId, p.why || null, {
          actor: "agent",
        })
        markProposalResolved(orgId, p.id)
        appendFeedEvent(orgId, {
          actor: "Агент",
          isAI: true,
          text:
            "Агент перевёл {deal}: " +
            p.fromLabel +
            " → " +
            p.toLabel +
            (p.why ? " — " + p.why : "") +
            ".",
          dealName: p.dealName,
        })
        applied++
      } catch {
        // Одна неудача (гонка со скрытием сделки и т.п.) не валит остальные —
        // предложение останется pending и применится на следующей загрузке.
      }
    }

    // Контракт сохранён: доска по-прежнему читает { proposals }, но ожидающих
    // больше не бывает — всё применено (applied — для отладки/тостов).
    return NextResponse.json({ proposals: [], applied })
  } catch (error) {
    return errorResponse(error)
  }
}
