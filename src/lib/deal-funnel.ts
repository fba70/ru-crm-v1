// UI-only Russian labels for the seeded **system** funnel stages. The DB stage
// names stay English (Qualification … Rejected) — deals reference stage rows by
// id, and discovery/seed logic matches on the English names — so this is a pure
// presentation map. Any custom org-defined stage falls through to its own name.
export const DEAL_STAGE_LABEL: Record<string, string> = {
  Qualification: "Квалификация",
  Discovery: "Потребности",
  Pilot: "Пилот",
  Proposal: "КП",
  Negotiations: "Переговоры",
  Closed: "Закрыта",
  Rejected: "Проиграна",
}

export function dealStageLabel(name: string): string {
  return DEAL_STAGE_LABEL[name] ?? name
}
