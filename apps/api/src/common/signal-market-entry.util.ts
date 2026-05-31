import type { SignalDto } from '@repo/shared';

export function hasExplicitEntryPrices(entries: number[] | undefined | null): boolean {
  return (entries ?? []).some((e) => Number.isFinite(Number(e)) && Number(e) > 0);
}

export function applyMarketEntryPrice(signal: SignalDto, lastPrice: number): SignalDto {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    return signal;
  }
  return {
    ...signal,
    entries: [lastPrice],
    entryIsRange: false,
  };
}
