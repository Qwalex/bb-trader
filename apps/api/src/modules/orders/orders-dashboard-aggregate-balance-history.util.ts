import {
  addCalendarDaysInTimeZone,
  endOfCalendarDayInTimeZone,
  resolveAppTimeZone,
  startOfCalendarDayInTimeZone,
} from '@repo/shared';

/** Строка снимка для построения суммарного equity по дням (календарь APP_TIMEZONE). */
export type BalanceSnapshotRowInput = {
  cabinetId: string | null;
  createdAt: Date;
  totalUsd: number;
};

/**
 * Сумма equity по календарным суткам APP_TIMEZONE: на конец каждого дня — последний известный снимок
 * по каждому кабинету (carry-forward внутри окна; сиды до `since` передаются отдельно в `rows`).
 */
export function buildAggregatedBalanceHistoryPoints(
  cabinetIds: string[],
  rows: BalanceSnapshotRowInput[],
  days: number,
  now: Date = new Date(),
  timeZone: string = resolveAppTimeZone(),
): { at: string; totalUsd: number }[] {
  const ids = cabinetIds.filter((id) => String(id).trim().length > 0);
  if (ids.length === 0) {
    return [];
  }
  const d = Math.min(Math.max(1, Math.floor(days)), 365);
  const idSet = new Set(ids);
  const sorted = [...rows]
    .filter(
      (r) =>
        r.cabinetId != null &&
        idSet.has(r.cabinetId) &&
        Number.isFinite(r.totalUsd),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const endDayStart = startOfCalendarDayInTimeZone(now, timeZone);
  const startDayStart = addCalendarDaysInTimeZone(endDayStart, -(d - 1), timeZone);

  const lastByCabinet = new Map<string, number>();
  const points: { at: string; totalUsd: number }[] = [];
  let si = 0;

  for (
    let dayStart = startDayStart;
    dayStart.getTime() <= endDayStart.getTime();
    dayStart = addCalendarDaysInTimeZone(dayStart, 1, timeZone)
  ) {
    const dayEnd = endOfCalendarDayInTimeZone(dayStart, timeZone);

    while (si < sorted.length) {
      const r = sorted[si];
      if (!r || r.createdAt.getTime() > dayEnd.getTime()) {
        break;
      }
      if (r.cabinetId != null) {
        lastByCabinet.set(r.cabinetId, r.totalUsd);
      }
      si += 1;
    }

    let sum = 0;
    for (const cid of ids) {
      const v = lastByCabinet.get(cid);
      if (v != null && Number.isFinite(v)) {
        sum += v;
      }
    }
    points.push({ at: dayEnd.toISOString(), totalUsd: sum });
  }

  return points;
}
