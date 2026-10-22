// «Человеческие» дата-группы событий (UX №16), как в Outlook: сегодня,
// вчера, день недели, прошлая неделя, прошлый месяц, ранее. Общие для
// «Ленты решений» и уведомлений.
export function dateGroupLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  const startOfDay = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime()
  const diff = Math.round((startOfToday - startOfDay) / 86_400_000)
  if (diff <= 0) return "Сегодня"
  if (diff === 1) return "Вчера"
  if (diff < 7) {
    const wd = d.toLocaleDateString("ru-RU", { weekday: "long" })
    return wd.charAt(0).toUpperCase() + wd.slice(1)
  }
  if (diff < 14) return "Прошлая неделя"
  if (diff < 31) return "Прошлый месяц"
  return "Ранее"
}

// Группирует события по дата-группам, сохраняя исходный порядок.
export function groupByDate<T>(
  items: T[],
  dateOf: (item: T) => string,
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = []
  for (const item of items) {
    const label = dateGroupLabel(dateOf(item))
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}
