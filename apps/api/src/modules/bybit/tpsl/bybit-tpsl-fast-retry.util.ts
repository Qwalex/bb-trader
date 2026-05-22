export const TP_SL_FAST_RETRY_DELAYS_MS_DEFAULT = [0, 300, 700, 1500, 3000, 5000];

export function parseTpSlFastRetryDelaysMs(raw: string | undefined | null): number[] {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return [...TP_SL_FAST_RETRY_DELAYS_MS_DEFAULT];
  }
  const parts = trimmed
    .split(/[,;\s]+/)
    .map((p) => Math.trunc(Number(p.replace(',', '.'))))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (parts.length === 0) {
    return [...TP_SL_FAST_RETRY_DELAYS_MS_DEFAULT];
  }
  return parts.slice(0, 12);
}

export function parseWorkerQueuePollConcurrency(
  raw: string | undefined | null,
  envFallback: number,
): number {
  const trimmed = String(raw ?? '').trim();
  const n = trimmed ? Number(trimmed) : envFallback;
  if (!Number.isFinite(n)) {
    return 3;
  }
  return Math.min(Math.max(Math.trunc(n), 1), 8);
}

export function isTruthySetting(raw: string | undefined | null): boolean {
  const t = String(raw ?? '').trim().toLowerCase();
  return t === 'true' || t === '1' || t === 'yes' || t === 'on';
}
