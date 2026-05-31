import type { SignalDto } from '@repo/shared';

import {
  calculateMovePercent,
  normalizeDirection,
  toFixedPrice,
} from '../telegram-userbot/mirror/telegram-userbot-mirror-format.util';

type SignalRow = {
  id: string;
  pair: string;
  direction: string;
  entries: string;
  stopLoss: number;
  takeProfits: string;
  leverage: number;
  marketType: string;
  capitalPercent: number;
  source?: string | null;
  status: string;
  realizedPnl?: number | null;
  liquidation?: boolean;
  closedAt?: Date | null;
  createdAt: Date;
  orders?: Array<{
    orderKind: string;
    status: string | null;
    price: number | null;
  }>;
};

function parseNumberArray(raw: string | undefined | null): number[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => Number.isFinite(Number(v))).map(Number);
  } catch {
    return [];
  }
}

function formatPairForQpulse(pair: string): string {
  const normalized = String(pair ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (normalized.endsWith('USDT') && normalized.length > 4) {
    const base = normalized.slice(0, -4);
    return `${base} / USDT`;
  }
  return pair.toUpperCase();
}

function entryMid(entries: number[]): number {
  if (entries.length === 0) return 0;
  const sorted = [...entries].sort((a, b) => a - b);
  const low = sorted[0] ?? 0;
  const high = sorted[sorted.length - 1] ?? low;
  return (low + high) / 2;
}

function countFilledTpOrders(
  orders: SignalRow['orders'],
  takeProfits: number[],
): number {
  if (!orders?.length || takeProfits.length === 0) return 0;
  const filledTpPrices = new Set(
    orders
      .filter(
        (o) =>
          o.orderKind === 'TP' &&
          String(o.status ?? '').toLowerCase().includes('filled') &&
          o.price != null,
      )
      .map((o) => Number(o.price)),
  );
  let hits = 0;
  for (const tp of takeProfits) {
    if ([...filledTpPrices].some((p) => Math.abs(p - tp) < 1e-8)) {
      hits += 1;
    }
  }
  return hits;
}

function mapStatus(status: string, liquidation?: boolean): string {
  const s = String(status ?? '').toUpperCase();
  if (s === 'FAILED' || s.includes('CANCEL')) return 'CANCELLED';
  if (s.startsWith('CLOSED') || s === 'CLOSED_WIN' || s === 'CLOSED_LOSS' || s === 'CLOSED_MIXED') {
    return 'CLOSED';
  }
  if (s === 'OPEN' || s === 'ORDERS_PLACED') return 'OPEN';
  if (s === 'PARSED' || s === 'PENDING') return 'OPEN';
  if (liquidation) return 'CLOSED';
  return 'ACTIVE';
}

function computeProfitPercentage(params: {
  entry: number;
  realizedPnl?: number | null;
  leverage: number;
  orderUsd?: number;
  capitalPercent: number;
}): number | null {
  const pnl = params.realizedPnl;
  if (pnl == null || !Number.isFinite(pnl)) return null;
  const notional =
    params.orderUsd && params.orderUsd > 0
      ? params.orderUsd
      : Math.max(1, params.capitalPercent);
  if (notional <= 0) return null;
  return (pnl / notional) * 100 * Math.max(1, params.leverage);
}

export function mapSignalRowToQpulsePayload(row: SignalRow): Record<string, unknown> {
  const entries = parseNumberArray(row.entries);
  const takeProfits = parseNumberArray(row.takeProfits);
  const mid = entryMid(entries);
  const direction = normalizeDirection(row.direction as SignalDto['direction']);
  const marketTypeRaw = String(row.marketType ?? 'linear').toLowerCase();
  const isSpot = marketTypeRaw === 'spot';
  const tpHits = countFilledTpOrders(row.orders, takeProfits);
  const mappedStatus = mapStatus(row.status, row.liquidation === true);
  const closed = mappedStatus === 'CLOSED';

  const targets = takeProfits.map((price, index) => ({
    label: `Target ${String(index + 1).padStart(2, '0')}`,
    price,
    profitPercent: Number.parseFloat(
      calculateMovePercent({ from: mid, to: price, direction }).replace('%', ''),
    ) || 0,
    hit: index < tpHits,
  }));

  const slHit =
    closed &&
    row.liquidation !== true &&
    (row.realizedPnl ?? 0) < 0 &&
    tpHits === 0;

  const profitPercentage = computeProfitPercentage({
    entry: mid,
    realizedPnl: row.realizedPnl,
    leverage: row.leverage,
    capitalPercent: row.capitalPercent,
  });

  return {
    externalId: row.id,
    source: row.source ?? undefined,
    pair: formatPairForQpulse(row.pair),
    marketType: isSpot ? 'SPOT' : 'FUTURES',
    direction: isSpot ? undefined : direction,
    action: isSpot ? 'BUY' : undefined,
    entryPrice: mid,
    capitalPercentage: row.capitalPercent > 0 ? row.capitalPercent : 1,
    leverage: isSpot ? undefined : row.leverage,
    openDate: row.createdAt.toISOString(),
    closeDate: closed ? (row.closedAt ?? new Date()).toISOString() : null,
    status: mappedStatus === 'CLOSED' && row.liquidation ? 'CLOSED' : mappedStatus,
    slHit,
    liquidated: row.liquidation === true,
    profitPercentage,
    details: {
      targets,
      stopLoss: row.stopLoss,
    },
  };
}

export function buildMirrorTradeEventText(params: {
  kind: 'tp' | 'sl' | 'close' | 'liquidation' | 'cancel';
  pair: string;
  detail?: string;
  pnl?: number | null;
}): string {
  const pair = params.pair.toUpperCase();
  switch (params.kind) {
    case 'tp':
      return `🎯 ${pair}: ${params.detail ?? 'Take profit hit'}`;
    case 'sl':
      return `🛑 ${pair}: Stop loss hit`;
    case 'liquidation':
      return `💥 ${pair}: Liquidation`;
    case 'cancel':
      return `❌ ${pair}: Signal cancelled`;
    case 'close':
    default: {
      const pnl =
        params.pnl != null && Number.isFinite(params.pnl)
          ? ` PnL: ${params.pnl >= 0 ? '+' : ''}${params.pnl.toFixed(2)} USDT`
          : '';
      return `✅ ${pair}: Trade closed${pnl}`;
    }
  }
}
