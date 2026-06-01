/** Статусы «открытого» сигнала — как в `getDashboardStats` / `openSignals`. */
export const DASHBOARD_ACTIVE_SIGNAL_STATUSES = [
  'PENDING',
  'ORDERS_PLACED',
  'OPEN',
  'PARSED',
] as const;

export const DASHBOARD_CLOSED_SIGNAL_STATUSES = [
  'CLOSED_WIN',
  'CLOSED_LOSS',
  'CLOSED_MIXED',
] as const;

export type DashboardUtilizationSignalRow = {
  createdAt: Date;
  closedAt: Date | null;
  source: string | null;
  status: string;
};

export type DashboardBalanceSnapshotRow = {
  totalUsd: number;
  availableUsd: number | null;
  createdAt: Date;
};

/** Среднее время исполнения закрытых сигналов (createdAt → closedAt), мс. */
export function computeAvgSignalExecutionMs(
  closedSignals: Array<{ createdAt: Date; closedAt: Date | null }>,
): number | null {
  const durations: number[] = [];
  for (const row of closedSignals) {
    if (!(row.createdAt instanceof Date) || !(row.closedAt instanceof Date)) continue;
    const startMs = row.createdAt.getTime();
    const endMs = row.closedAt.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    durations.push(endMs - startMs);
  }
  if (durations.length === 0) return null;
  return durations.reduce((acc, v) => acc + v, 0) / durations.length;
}

/**
 * Средняя длительность периодов простоя (0 открытых сигналов) в окне [windowStartMs, windowEndMs].
 * Сигнал занимает кабинет с createdAt до closedAt (или до конца окна, если ещё открыт).
 */
export function computeAvgIdlePeriodMs(
  signals: Array<{ createdAt: Date; closedAt: Date | null }>,
  windowStartMs: number,
  windowEndMs: number,
): number | null {
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
    return null;
  }

  const intervals: Array<{ start: number; end: number }> = [];
  for (const row of signals) {
    if (!(row.createdAt instanceof Date)) continue;
    const start = Math.max(windowStartMs, row.createdAt.getTime());
    const end = Math.min(
      windowEndMs,
      row.closedAt instanceof Date && !Number.isNaN(row.closedAt.getTime())
        ? row.closedAt.getTime()
        : windowEndMs,
    );
    if (end > start) {
      intervals.push({ start, end });
    }
  }

  intervals.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (!last || iv.start > last.end) {
      merged.push({ ...iv });
    } else {
      last.end = Math.max(last.end, iv.end);
    }
  }

  const idleDurations: number[] = [];
  let cursor = windowStartMs;
  for (const iv of merged) {
    if (iv.start > cursor) {
      idleDurations.push(iv.start - cursor);
    }
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < windowEndMs) {
    idleDurations.push(windowEndMs - cursor);
  }

  if (idleDurations.length === 0) return null;
  return idleDurations.reduce((acc, v) => acc + v, 0) / idleDurations.length;
}

/** Доля не задействованного баланса: available / total (0…1). */
export function computeUnusedBalanceRatio(
  availableUsd: number | null | undefined,
  totalUsd: number | null | undefined,
): number | null {
  const total = totalUsd != null && Number.isFinite(totalUsd) ? totalUsd : null;
  const available = availableUsd != null && Number.isFinite(availableUsd) ? availableUsd : null;
  if (total == null || total <= 0 || available == null) return null;
  return Math.min(1, Math.max(0, available / total));
}

/**
 * Средняя доля не задействованного баланса за последние `days` календарных дней (UTC-снимки).
 * Берутся только снимки с известным availableUsd.
 */
export function computeAvgUnusedBalanceRatioMonth(
  snapshots: DashboardBalanceSnapshotRow[],
  days = 30,
): number | null {
  const d = Math.min(Math.max(1, Math.floor(days)), 365);
  const sinceMs = Date.now() - d * 86_400_000;
  const ratios: number[] = [];
  for (const row of snapshots) {
    if (!(row.createdAt instanceof Date) || row.createdAt.getTime() < sinceMs) continue;
    const ratio = computeUnusedBalanceRatio(row.availableUsd, row.totalUsd);
    if (ratio != null) ratios.push(ratio);
  }
  if (ratios.length === 0) return null;
  return ratios.reduce((acc, v) => acc + v, 0) / ratios.length;
}

export function filterSignalsByExcludedSources<T extends { source: string | null }>(
  rows: T[],
  excluded: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => !excluded.has(String(row.source ?? '')));
}
