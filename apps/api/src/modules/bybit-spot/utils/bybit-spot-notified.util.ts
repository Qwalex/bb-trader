import type { SpotNotifiedState } from '../types/bybit-spot.types';

export function parseSpotNotifiedJson(raw: string | null | undefined): SpotNotifiedState {
  if (!raw?.trim()) {
    return { tpHit: [], slHit: false };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SpotNotifiedState>;
    const tpHit = Array.isArray(parsed.tpHit)
      ? parsed.tpHit.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      : [];
    return { tpHit, slHit: parsed.slHit === true };
  } catch {
    return { tpHit: [], slHit: false };
  }
}

export function serializeSpotNotifiedJson(state: SpotNotifiedState): string {
  return JSON.stringify(state);
}
