import type { SignalDto } from '@repo/shared';

import {
  calculateMovePercent,
  normalizeDirection,
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
  orderUsd?: number;
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

function isFilledOrderStatus(status: string | null | undefined): boolean {
  return String(status ?? '').toLowerCase().includes('filled');
}

function hasFilledEntryOrder(orders: SignalRow['orders']): boolean {
  return (orders ?? []).some(
    (o) =>
      (o.orderKind === 'ENTRY' || o.orderKind === 'DCA') && isFilledOrderStatus(o.status),
  );
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
          isFilledOrderStatus(o.status) &&
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

function mapStatus(
  status: string,
  params: { liquidation?: boolean; isSpot: boolean; hasFilledEntry: boolean },
): string {
  const s = String(status ?? '').toUpperCase();
  if (s === 'FAILED' || s.includes('CANCEL')) return 'CANCELLED';
  if (
    s.startsWith('CLOSED') ||
    s === 'CLOSED_WIN' ||
    s === 'CLOSED_LOSS' ||
    s === 'CLOSED_MIXED'
  ) {
    return 'CLOSED';
  }
  if (params.liquidation) return 'CLOSED';
  if (s === 'OPEN' && params.isSpot) return 'ACTIVE';
  if (s === 'ORDERS_PLACED' && params.hasFilledEntry) return 'ACTIVE';
  if (s === 'OPEN' || s === 'ORDERS_PLACED' || s === 'PARSED' || s === 'PENDING') {
    return 'OPEN';
  }
  return 'ACTIVE';
}

function computeProfitPercentage(params: {
  realizedPnl?: number | null;
  leverage: number;
  orderUsd?: number;
  capitalPercent: number;
  isSpot: boolean;
}): number | null {
  const pnl = params.realizedPnl;
  if (pnl == null || !Number.isFinite(pnl)) return null;
  const notional =
    params.orderUsd && params.orderUsd > 0
      ? params.orderUsd
      : Math.max(1, params.capitalPercent);
  if (notional <= 0) return null;
  const leverage = params.isSpot ? 1 : Math.max(1, params.leverage);
  return (pnl / notional) * 100 * leverage;
}

export function mapSignalRowToQpulsePayload(row: SignalRow): Record<string, unknown> {
  const entries = parseNumberArray(row.entries);
  const takeProfits = parseNumberArray(row.takeProfits);
  const mid = entryMid(entries);
  const direction = normalizeDirection(row.direction as SignalDto['direction']);
  const marketTypeRaw = String(row.marketType ?? 'linear').toLowerCase();
  const isSpot = marketTypeRaw === 'spot';
  const hasFilledEntry = hasFilledEntryOrder(row.orders);
  const tpHits = countFilledTpOrders(row.orders, takeProfits);
  const mappedStatus = mapStatus(row.status, {
    liquidation: row.liquidation === true,
    isSpot,
    hasFilledEntry,
  });
  const closed = mappedStatus === 'CLOSED';
  const positionSizeUsdt = row.orderUsd && row.orderUsd > 0 ? row.orderUsd : null;
  const realizedPnlUsdt =
    row.realizedPnl != null && Number.isFinite(row.realizedPnl) ? row.realizedPnl : null;

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
    realizedPnl: row.realizedPnl,
    leverage: row.leverage,
    orderUsd: row.orderUsd,
    capitalPercent: row.capitalPercent,
    isSpot,
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
    status: mappedStatus,
    slHit,
    liquidated: row.liquidation === true,
    positionSizeUsdt,
    realizedPnlUsdt,
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
