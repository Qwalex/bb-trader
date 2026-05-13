/** Строка снимка для построения суммарного equity по дням (UTC). */
export type BalanceSnapshotRowInput = {
  cabinetId: string | null;
  createdAt: Date;
  totalUsd: number;
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Сумма equity по календарным суткам UTC: на конец каждого дня — последний известный снимок
 * по каждому кабинету (carry-forward внутри окна; сиды до `since` передаются отдельно в `rows`).
 */
export function buildAggregatedBalanceHistoryPoints(
  cabinetIds: string[],
  rows: BalanceSnapshotRowInput[],
  days: number,
  now: Date = new Date(),
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

  const endDay = startOfUtcDay(now);
  const startDay = new Date(endDay);
  startDay.setUTCDate(startDay.getUTCDate() - (d - 1));

  const lastByCabinet = new Map<string, number>();
  const points: { at: string; totalUsd: number }[] = [];
  let si = 0;

  for (
    let day = new Date(startDay);
    day.getTime() <= endDay.getTime();
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const dayEnd = new Date(day);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    dayEnd.setUTCMilliseconds(dayEnd.getUTCMilliseconds() - 1);

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
