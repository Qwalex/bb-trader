import type { SignalDto } from '@repo/shared';

import {
  calculateMovePercent,
  formatMirrorEntryFilledText,
  formatMirrorTpFilledText,
  formatMirrorTpHitsLine,
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
  const valid = entries.filter((e) => Number.isFinite(e) && e > 0);
  if (valid.length === 0) return 0;
  const sorted = [...valid].sort((a, b) => a - b);
  const low = sorted[0] ?? 0;
  const high = sorted[sorted.length - 1] ?? low;
  return (low + high) / 2;
}

function resolveEntryPrice(row: SignalRow, entries: number[]): number {
  const mid = entryMid(entries);
  if (mid > 0) return mid;
  const filledEntry = (row.orders ?? []).find(
    (o) =>
      (o.orderKind === 'ENTRY' || o.orderKind === 'DCA') &&
      isFilledOrderStatus(o.status) &&
      o.price != null &&
      Number(o.price) > 0,
  );
  return filledEntry?.price != null ? Number(filledEntry.price) : 0;
}

function isFilledOrderStatus(status: string | null | undefined): boolean {
  return String(status ?? '').toLowerCase().includes('filled');
}

function pricesMatch(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const tol = Math.max(1e-6, Math.abs(b) * 1e-4);
  return Math.abs(a - b) <= tol;
}

function countFilledTpLevels(
  orders: SignalRow['orders'],
  takeProfits: number[],
  direction: string,
): number {
  if (!orders?.length || takeProfits.length === 0) return 0;
  const sorted = [...takeProfits].sort((a, b) =>
    direction === 'short' ? b - a : a - b,
  );
  let hits = 0;
  for (const tp of sorted) {
    const filled = (orders ?? []).some(
      (o) =>
        o.orderKind === 'TP' &&
        isFilledOrderStatus(o.status) &&
        o.price != null &&
        pricesMatch(Number(o.price), tp),
    );
    if (!filled) break;
    hits += 1;
  }
  return hits;
}

function isTpLevelHit(
  orders: SignalRow['orders'],
  takeProfits: number[],
  direction: string,
  index: number,
): boolean {
  const sorted = [...takeProfits].sort((a, b) =>
    direction === 'short' ? b - a : a - b,
  );
  const tp = sorted[index];
  if (tp == null) return false;
  return (orders ?? []).some(
    (o) =>
      o.orderKind === 'TP' &&
      isFilledOrderStatus(o.status) &&
      o.price != null &&
      pricesMatch(Number(o.price), tp),
  );
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
  direction = 'long',
): number {
  return countFilledTpLevels(orders, takeProfits, direction);
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

export function formatProfitPercentDisplay(percent: number): string {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

export function formatMirrorProfitPercent(params: {
  realizedPnl?: number | null;
  leverage?: number;
  orderUsd?: number;
  capitalPercent?: number;
  isSpot?: boolean;
  profitPercentOverride?: number | null;
}): string | null {
  if (
    params.profitPercentOverride != null &&
    Number.isFinite(params.profitPercentOverride)
  ) {
    return formatProfitPercentDisplay(params.profitPercentOverride);
  }
  const pct = computeProfitPercentage({
    realizedPnl: params.realizedPnl,
    leverage: params.leverage ?? 1,
    orderUsd: params.orderUsd,
    capitalPercent: params.capitalPercent ?? 0,
    isSpot: params.isSpot === true,
  });
  if (pct == null || !Number.isFinite(pct)) return null;
  return formatProfitPercentDisplay(pct);
}

/** @deprecated alias */
export const formatMirrorPnlPercent = formatMirrorProfitPercent;

export function mapSignalRowToQpulsePayload(row: SignalRow): Record<string, unknown> {
  const entries = parseNumberArray(row.entries);
  const takeProfits = parseNumberArray(row.takeProfits);
  const mid = resolveEntryPrice(row, entries);
  const tradeDirection = normalizeDirection(row.direction as SignalDto['direction']);
  const directionRaw = String(row.direction ?? 'long').toLowerCase();
  const marketTypeRaw = String(row.marketType ?? 'linear').toLowerCase();
  const isSpot = marketTypeRaw === 'spot';
  const hasFilledEntry = hasFilledEntryOrder(row.orders);
  const tpHits = countFilledTpOrders(row.orders, takeProfits, directionRaw);
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
      calculateMovePercent({ from: mid, to: price, direction: tradeDirection }).replace('%', ''),
    ) || 0,
    hit: isTpLevelHit(row.orders, takeProfits, directionRaw, index),
  }));

  const slHit =
    closed &&
    row.liquidation !== true &&
    (String(row.status ?? '').toUpperCase() === 'CLOSED_LOSS' ||
      (String(row.status ?? '').toUpperCase() === 'CLOSED_MIXED' &&
        (row.realizedPnl ?? 0) < 0));

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
    direction: isSpot ? undefined : tradeDirection,
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

export type MirrorCloseSignalInput = {
  pair: string;
  status: string;
  direction: string;
  takeProfits: string;
  liquidation?: boolean;
  realizedPnl?: number | null;
  leverage: number;
  orderUsd?: number;
  capitalPercent: number;
  marketType: string;
  orders?: SignalRow['orders'];
  profitPercentOverride?: number | null;
};

export function resolveMirrorCloseContext(input: MirrorCloseSignalInput): {
  mirrorKind: 'sl' | 'close' | 'liquidation';
  tpHits: number;
  totalTps: number;
  profitPercent: string | null;
  isLoss: boolean;
} {
  const takeProfits = parseNumberArray(input.takeProfits);
  const directionRaw = String(input.direction ?? 'long').toLowerCase();
  const tpHits = countFilledTpOrders(input.orders, takeProfits, directionRaw);
  const isSpot = String(input.marketType ?? 'linear').toLowerCase() === 'spot';
  const status = String(input.status ?? '').toUpperCase();
  const pnl = input.realizedPnl;
  const hasRealizedPnl = pnl != null && Number.isFinite(pnl);
  const profitPercent = formatMirrorProfitPercent({
    realizedPnl: pnl,
    leverage: input.leverage,
    orderUsd: input.orderUsd,
    capitalPercent: input.capitalPercent,
    isSpot,
    profitPercentOverride: hasRealizedPnl ? undefined : input.profitPercentOverride,
  });
  const isLoss =
    status === 'CLOSED_LOSS' || (hasRealizedPnl && pnl < 0);

  if (input.liquidation === true) {
    return {
      mirrorKind: 'liquidation',
      tpHits,
      totalTps: takeProfits.length,
      profitPercent,
      isLoss: true,
    };
  }

  if (
    status === 'CLOSED_LOSS' ||
    (isLoss && tpHits < takeProfits.length)
  ) {
    return {
      mirrorKind: 'sl',
      tpHits,
      totalTps: takeProfits.length,
      profitPercent,
      isLoss,
    };
  }

  return {
    mirrorKind: 'close',
    tpHits,
    totalTps: takeProfits.length,
    profitPercent,
    isLoss: false,
  };
}

export function buildMirrorCloseEventText(input: MirrorCloseSignalInput): string {
  const pair = input.pair.toUpperCase();
  const ctx = resolveMirrorCloseContext(input);
  const resultLabel = ctx.isLoss ? 'Loss' : 'Profit';
  const resultEmoji = ctx.isLoss ? '📉' : '📈';
  const tpHitsLine = formatMirrorTpHitsLine(ctx.tpHits);

  if (ctx.mirrorKind === 'liquidation') {
    const lines = [`💥 ${pair} · Liquidation`];
    if (tpHitsLine) lines.push(tpHitsLine);
    if (ctx.profitPercent) {
      lines.push(`${resultEmoji} ${resultLabel}: ${ctx.profitPercent}`);
    }
    return lines.join('\n');
  }

  if (ctx.mirrorKind === 'sl') {
    const lines = [`🛑 ${pair} · Stop loss hit`];
    if (tpHitsLine) lines.push(tpHitsLine);
    if (ctx.profitPercent) {
      lines.push(`${resultEmoji} ${resultLabel}: ${ctx.profitPercent}`);
    }
    return lines.join('\n');
  }

  const lines = [`✅ ${pair} · Trade closed`];
  if (ctx.totalTps > 0 && ctx.tpHits >= ctx.totalTps) {
    lines.push('🎯 All take profits hit');
  } else if (tpHitsLine) {
    lines.push(tpHitsLine);
  }
  if (ctx.profitPercent) {
    lines.push(`${resultEmoji} ${resultLabel}: ${ctx.profitPercent}`);
  }
  return lines.join('\n');
}

export function buildMirrorTradeEventText(params: {
  kind: 'tp' | 'sl' | 'close' | 'liquidation' | 'cancel' | 'entry';
  pair: string;
  detail?: string;
  tpNumber?: number;
  tpPrice?: number | null;
  entryPrice?: number | null;
  pnl?: number | null;
  leverage?: number;
  orderUsd?: number;
  capitalPercent?: number;
  isSpot?: boolean;
  profitPercentOverride?: number | null;
  closeStatus?: string;
  closeDirection?: string;
  closeTakeProfits?: string;
  closeOrders?: SignalRow['orders'];
  tpDirection?: 'LONG' | 'SHORT';
  tpEntryPrice?: number | null;
  tpTakeProfits?: number[];
}): string {
  const pair = params.pair.toUpperCase();
  switch (params.kind) {
    case 'entry':
      if (params.entryPrice != null || params.detail) {
        const price =
          params.entryPrice ??
          (params.detail && Number.isFinite(Number(params.detail))
            ? Number(params.detail)
            : null);
        return formatMirrorEntryFilledText({ pair, price });
      }
      return formatMirrorEntryFilledText({ pair });
    case 'tp':
      if (params.tpNumber != null) {
        return formatMirrorTpFilledText({
          pair,
          tpNumber: params.tpNumber,
          price: params.tpPrice,
          direction: params.tpDirection,
          entryPrice: params.tpEntryPrice,
          takeProfits: params.tpTakeProfits,
        });
      }
      return formatMirrorTpFilledText({
        pair,
        tpNumber: 1,
        price: params.tpPrice ?? null,
        direction: params.tpDirection,
        entryPrice: params.tpEntryPrice,
        takeProfits: params.tpTakeProfits,
      });
    case 'sl':
    case 'liquidation':
    case 'close':
      return buildMirrorCloseEventText({
        pair: params.pair,
        status: params.closeStatus ?? (params.kind === 'sl' ? 'CLOSED_LOSS' : 'CLOSED_WIN'),
        direction: params.closeDirection ?? 'long',
        takeProfits: params.closeTakeProfits ?? '[]',
        liquidation: params.kind === 'liquidation',
        realizedPnl: params.pnl,
        leverage: params.leverage ?? 1,
        orderUsd: params.orderUsd,
        capitalPercent: params.capitalPercent ?? 0,
        marketType: params.isSpot ? 'spot' : 'linear',
        orders: params.closeOrders,
        profitPercentOverride: params.profitPercentOverride,
      });
    case 'cancel':
      return `❌ ${pair}: Signal cancelled`;
    default:
      return buildMirrorCloseEventText({
        pair: params.pair,
        status: params.closeStatus ?? 'CLOSED_WIN',
        direction: params.closeDirection ?? 'long',
        takeProfits: params.closeTakeProfits ?? '[]',
        realizedPnl: params.pnl,
        leverage: params.leverage ?? 1,
        orderUsd: params.orderUsd,
        capitalPercent: params.capitalPercent ?? 0,
        marketType: params.isSpot ? 'spot' : 'linear',
        orders: params.closeOrders,
        profitPercentOverride: params.profitPercentOverride,
      });
  }
}

export function buildMirrorOutcomeText(params: {
  pair: string;
  status?: string;
  direction?: string;
  takeProfits?: string;
  orders?: SignalRow['orders'];
  realizedPnl?: number | null;
  leverage?: number;
  orderUsd?: number;
  capitalPercent?: number;
  marketType?: string | null;
  liquidation?: boolean;
  profitPercentFromSource?: number | null;
}): string {
  return buildMirrorCloseEventText({
    pair: params.pair,
    status: params.status ?? 'CLOSED_WIN',
    direction: params.direction ?? 'long',
    takeProfits: params.takeProfits ?? '[]',
    liquidation: params.liquidation === true,
    realizedPnl: params.realizedPnl,
    leverage: params.leverage ?? 1,
    orderUsd: params.orderUsd,
    capitalPercent: params.capitalPercent ?? 0,
    marketType: params.marketType ?? 'linear',
    orders: params.orders,
    profitPercentOverride:
      params.realizedPnl != null && Number.isFinite(params.realizedPnl)
        ? undefined
        : params.profitPercentFromSource,
  });
}
