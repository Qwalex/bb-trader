import type { StuckTradesHealSettings } from './bybit-stuck-trades-heal.types';

const DEFAULT_INTERVAL_MS = 180_000;
const DEFAULT_MAX_PER_RUN = 2;
const DEFAULT_COOLDOWN_MS = 600_000;
const DEFAULT_DEFER_BACKOFF_MS = 120_000;

export function parseStuckTradesAutoHealEnabled(raw: string | null | undefined): boolean {
  const t = (raw ?? '').trim().toLowerCase();
  if (!t || t === 'true' || t === '1' || t === 'yes' || t === 'on') {
    return true;
  }
  return false;
}

export function parseStuckTradesHealSettings(
  raw: Partial<Record<string, string | null | undefined>>,
): StuckTradesHealSettings {
  const enabled = parseStuckTradesAutoHealEnabled(raw.STUCK_TRADES_AUTO_HEAL_ENABLED);
  const intervalMs = parseBoundedMs(raw.STUCK_TRADES_AUTO_HEAL_INTERVAL_MS, DEFAULT_INTERVAL_MS, 60_000, 900_000);
  const maxPerRun = parseBoundedInt(raw.STUCK_TRADES_AUTO_HEAL_MAX_PER_RUN, DEFAULT_MAX_PER_RUN, 1, 5);
  const cooldownMs = parseBoundedMs(raw.STUCK_TRADES_AUTO_HEAL_COOLDOWN_MS, DEFAULT_COOLDOWN_MS, 60_000, 3_600_000);
  const deferBackoffMs = parseBoundedMs(
    raw.STUCK_TRADES_AUTO_HEAL_DEFER_BACKOFF_MS,
    DEFAULT_DEFER_BACKOFF_MS,
    30_000,
    600_000,
  );
  return { enabled, intervalMs, maxPerRun, cooldownMs, deferBackoffMs };
}

function parseBoundedMs(
  raw: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const t = (raw ?? '').trim();
  if (!t) {
    return fallback;
  }
  const n = Math.trunc(Number(t.replace(',', '.')));
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(Math.max(n, min), max);
}

function parseBoundedInt(
  raw: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const t = (raw ?? '').trim();
  if (!t) {
    return fallback;
  }
  const n = Math.trunc(Number(t.replace(',', '.')));
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(Math.max(n, min), max);
}
