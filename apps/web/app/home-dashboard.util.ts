/** Человекочитаемая длительность для метрик дашборда (ru). */
export function formatDashboardDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return '< 1 мин';
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
  const minutes = totalMinutes - days * 60 * 24 - hours * 60;
  if (days > 0) {
    return hours > 0 ? `${days}д ${hours}ч` : `${days}д`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}ч ${minutes}м` : `${hours}ч`;
  }
  return `${minutes} мин`;
}

/** Доля 0…1 → процент с одним знаком. */
export function formatDashboardRatioPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${(Math.min(1, Math.max(0, ratio)) * 100).toFixed(1)}%`;
}

/** Активные кабинеты первыми, деактивированные — в конце (порядок внутри группы сохраняется). */
export function sortDashboardCabinetCardsForDisplay<T extends { isActive?: boolean }>(
  items: T[],
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aInactive = a.item.isActive === false ? 1 : 0;
      const bInactive = b.item.isActive === false ? 1 : 0;
      if (aInactive !== bInactive) return aInactive - bInactive;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
