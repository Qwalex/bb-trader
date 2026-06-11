import type { Signal } from '@prisma/client';
import type { SignalDto } from '@repo/shared';

export function mapPrismaSignalToDto(row: Signal): SignalDto {
  const entries = safeJsonArray(row.entries);
  const takeProfits = safeJsonArray(row.takeProfits);
  return {
    pair: row.pair,
    direction: row.direction === 'short' ? 'short' : 'long',
    entries,
    entryIsRange: row.entryIsRange,
    stopLoss: row.stopLoss,
    takeProfits,
    leverage: row.leverage,
    orderUsd: row.orderUsd,
    capitalPercent: row.capitalPercent,
    source: row.source ?? undefined,
  };
}

function safeJsonArray(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}
