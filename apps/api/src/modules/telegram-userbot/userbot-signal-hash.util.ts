import { createHash } from 'node:crypto';

import type { SignalDto } from '@repo/shared';

/** Парсит JSON-массив цен из полей Signal.entries / takeProfits. */
export function parseSignalPriceArrayJson(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x > 0);
  } catch {
    return [];
  }
}

export function signalDtoFromSignalRow(row: {
  pair: string;
  direction: string;
  entries: string;
  stopLoss: number;
  takeProfits: string;
  leverage: number;
  orderUsd: number;
  capitalPercent: number;
  source: string | null;
}): SignalDto {
  const direction = row.direction === 'short' ? 'short' : 'long';
  return {
    pair: row.pair,
    direction,
    entries: parseSignalPriceArrayJson(row.entries),
    stopLoss: row.stopLoss,
    takeProfits: parseSignalPriceArrayJson(row.takeProfits),
    leverage: row.leverage,
    orderUsd: row.orderUsd,
    capitalPercent: row.capitalPercent,
    source: row.source ?? undefined,
  };
}

/**
 * Хеш «содержимого» сигнала для дедупликации userbot (без привязки к чату).
 * Должен совпадать с тем, что создаётся при первом успешном ingest.
 */
export function computeUserbotSignalHash(signal: SignalDto): string {
  const normalized = {
    pair: signal.pair.trim().toUpperCase(),
    direction: signal.direction,
    leverage: Number(signal.leverage),
    entries: signal.entries.map((v) => Number(v).toFixed(8)),
    stopLoss: Number(signal.stopLoss).toFixed(8),
    takeProfits: signal.takeProfits.map((v) => Number(v).toFixed(8)),
  };
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}
