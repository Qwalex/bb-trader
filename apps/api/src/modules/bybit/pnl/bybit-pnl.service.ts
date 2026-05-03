import { Injectable } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';
import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { BybitRateLimitService } from '../instrument/bybit-rate-limit.service';
import {
  buildClosedPnlWindow,
  isLiquidationExecutionRow,
} from './bybit-pnl.util';
import type { TradePnlBreakdownResult } from '../types/bybit.types';

@Injectable()
export class BybitPnlService {
  constructor(private readonly rateLimit: BybitRateLimitService) {}

  private extractClosedPnlOrderId(row: unknown): string {
    if (!row || typeof row !== 'object') {
      return '';
    }
    const r = row as Record<string, unknown>;
    const v = r.orderId ?? r.orderID;
    return v != null && String(v).length > 0 ? String(v) : '';
  }

  private parseFiniteNumber(value: unknown): number | undefined {
    if (value == null || String(value).trim() === '') {
      return undefined;
    }
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private extractClosedPnlTimestampMs(row: unknown): number | undefined {
    if (!row || typeof row !== 'object') {
      return undefined;
    }
    const r = row as Record<string, unknown>;
    const raw = r.createdTime ?? r.updatedTime ?? r.execTime ?? r.createdAt ?? r.updatedAt;
    if (raw == null || String(raw).trim() === '') {
      return undefined;
    }
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber;
    }
    const parsed = Date.parse(String(raw));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  sumClosedPnlForSignal(
    rows: unknown[],
    ourIds: Set<string>,
    direction: string,
    signalCreatedAt: Date,
    signalClosedAt?: Date | null,
  ): {
    totalPnl: number;
    grossPnl: number;
    hadParsedPnl: boolean;
    openFee: number;
    closeFee: number;
    execFee: number;
    totalFee: number;
  } {
    const createdAtMs = signalCreatedAt.getTime();
    const createdFloorMs = createdAtMs - 60_000;
    const expectedCloseSide = direction === 'short' ? 'buy' : 'sell';
    const closedCeilMs =
      signalClosedAt && Number.isFinite(signalClosedAt.getTime())
        ? signalClosedAt.getTime() + 5 * 60_000
        : undefined;

    const parsedRows = rows.map((row) => {
      const orderId = this.extractClosedPnlOrderId(row);
      const ts = this.extractClosedPnlTimestampMs(row);
      const rec = row as Record<string, unknown>;
      const side = String(rec.side ?? '').trim().toLowerCase();
      const pnlFinalFromBybit = this.parseFiniteNumber(rec.closedPnl) ?? Number.NaN;
      const openFee = Math.abs(this.parseFiniteNumber(rec.openFee) ?? 0);
      const closeFee = Math.abs(this.parseFiniteNumber(rec.closeFee) ?? 0);
      const execFee = Math.abs(this.parseFiniteNumber(rec.execFee) ?? 0);
      const fee = openFee + closeFee + execFee;
      const pnlGross = Number.isFinite(pnlFinalFromBybit)
        ? pnlFinalFromBybit + fee
        : Number.NaN;
      return { orderId, side, ts, pnlFinalFromBybit, pnlGross, openFee, closeFee, execFee };
    });

    const hasTrackedRows = parsedRows.some(
      (r) => r.orderId.length > 0 && ourIds.has(r.orderId),
    );
    const candidates = parsedRows.filter((r) => {
      if (r.side && r.side !== expectedCloseSide) return false;
      if (closedCeilMs !== undefined && r.ts !== undefined && r.ts > closedCeilMs) return false;
      if (r.orderId.length > 0 && ourIds.has(r.orderId)) return true;
      if (!hasTrackedRows) return false;
      return r.ts !== undefined && r.ts >= createdFloorMs;
    });

    let totalPnl = 0;
    let grossPnl = 0;
    let totalOpenFee = 0;
    let totalCloseFee = 0;
    let totalExecFee = 0;
    let hadParsedPnl = false;
    for (const row of candidates) {
      if (!Number.isFinite(row.pnlFinalFromBybit)) continue;
      totalPnl += row.pnlFinalFromBybit;
      if (Number.isFinite(row.pnlGross)) grossPnl += row.pnlGross;
      totalOpenFee += row.openFee;
      totalCloseFee += row.closeFee;
      totalExecFee += row.execFee;
      hadParsedPnl = true;
    }

    return {
      totalPnl,
      grossPnl,
      hadParsedPnl,
      openFee: totalOpenFee,
      closeFee: totalCloseFee,
      execFee: totalExecFee,
      totalFee: totalOpenFee + totalCloseFee + totalExecFee,
    };
  }

  buildClosedPnlWindow(
    signalCreatedAt: Date,
    signalClosedAt?: Date | null,
  ): { startTime: number; endTime: number } {
    return buildClosedPnlWindow(signalCreatedAt, signalClosedAt);
  }

  async fetchClosedPnlRowsForSymbol(
    client: RestClientV5,
    symbol: string,
    rangeStartMs: number,
    rangeEndMs: number,
  ): Promise<unknown[]> {
    const startMs = Math.max(0, rangeStartMs);
    const endMs = Math.max(startMs, rangeEndMs);
    const maxRangeMs = 7 * 24 * 60 * 60 * 1000;
    const rows: unknown[] = [];

    for (
      let rangeStart = startMs;
      rangeStart <= endMs;
      rangeStart += maxRangeMs + 1
    ) {
      const rangeEnd = Math.min(endMs, rangeStart + maxRangeMs);
      let cursor: string | undefined;
      const maxPages = 40;

      for (let page = 0; page < maxPages; page += 1) {
        const res = await this.rateLimit.runBybitCall(() =>
          client.getClosedPnL({
            category: 'linear',
            symbol,
            startTime: rangeStart,
            endTime: rangeEnd,
            limit: 100,
            cursor,
          }),
        );
        if (res.retCode !== 0) {
          break;
        }

        const list = res.result?.list ?? [];
        if (list.length > 0) {
          rows.push(...list);
        }
        cursor = res.result?.nextPageCursor || undefined;
        if (!cursor || list.length === 0) {
          break;
        }
      }
    }

    return rows;
  }

  async estimateClosedPnlFromExecutions(params: {
    client: RestClientV5;
    symbol: string;
    direction: string;
    createdAt: Date;
    closedAt?: Date | null;
  }): Promise<{ netPnl: number; grossPnl: number; totalFees: number } | undefined> {
    const createdFloorMs = params.createdAt.getTime() - 60_000;
    const closedCeilMs =
      params.closedAt && Number.isFinite(params.closedAt.getTime())
        ? params.closedAt.getTime() + 5 * 60_000
        : undefined;
    const rows: Array<{ side: string; qty: number; value: number; fee: number; ts: number }> = [];
    let cursor: string | undefined;
    const maxPages = 8;

    for (let page = 0; page < maxPages; page += 1) {
      const res = await this.rateLimit.runBybitCall(() =>
        params.client.getExecutionList({
          category: 'linear',
          symbol: params.symbol,
          limit: 50,
          cursor,
        }),
      );
      if (res.retCode !== 0) {
        break;
      }
      const list = res.result?.list ?? [];
      for (const ex of list) {
        const ts = Number(ex.execTime ?? 0);
        if (!Number.isFinite(ts) || ts < createdFloorMs) continue;
        if (closedCeilMs !== undefined && ts > closedCeilMs) continue;
        const qty = Number.parseFloat(String(ex.execQty ?? 0));
        const valueRaw = Number.parseFloat(String(ex.execValue ?? 0));
        const priceRaw = Number.parseFloat(String(ex.execPrice ?? 0));
        const feeRaw = Number.parseFloat(String(ex.execFee ?? 0));
        const value =
          Number.isFinite(valueRaw) && valueRaw > 0
            ? valueRaw
            : Number.isFinite(priceRaw) && Number.isFinite(qty)
              ? priceRaw * qty
              : Number.NaN;
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(value) || value <= 0) {
          continue;
        }
        rows.push({
          side: String(ex.side ?? '').toLowerCase(),
          qty,
          value,
          fee: Number.isFinite(feeRaw) ? Math.abs(feeRaw) : 0,
          ts,
        });
      }
      cursor = res.result?.nextPageCursor || undefined;
      if (!cursor || list.length === 0) {
        break;
      }
    }

    let buyQty = 0;
    let buyValue = 0;
    let sellQty = 0;
    let sellValue = 0;
    let totalFees = 0;
    for (const row of rows) {
      totalFees += row.fee;
      if (row.side === 'buy') {
        buyQty += row.qty;
        buyValue += row.value;
      } else if (row.side === 'sell') {
        sellQty += row.qty;
        sellValue += row.value;
      }
    }
    const matchedQty = Math.min(buyQty, sellQty);
    if (!Number.isFinite(matchedQty) || matchedQty <= 0) {
      return undefined;
    }
    const avgBuy = buyValue / buyQty;
    const avgSell = sellValue / sellQty;
    if (!Number.isFinite(avgBuy) || !Number.isFinite(avgSell)) {
      return undefined;
    }
    const pnl = (avgSell - avgBuy) * matchedQty;
    const netPnl = pnl - totalFees;
    if (!Number.isFinite(netPnl)) {
      return undefined;
    }
    return { netPnl, grossPnl: pnl, totalFees };
  }

  async detectLiquidationByExecutions(params: {
    client: RestClientV5;
    symbol: string;
    direction: 'long' | 'short';
    createdAt: Date;
    closedAt?: Date | null;
    trackedOrderIds: Set<string>;
  }): Promise<boolean> {
    const createdFloorMs = params.createdAt.getTime() - 60_000;
    const closedCeilMs =
      params.closedAt && Number.isFinite(params.closedAt.getTime())
        ? params.closedAt.getTime() + 5 * 60_000
        : undefined;
    const expectedCloseSide = params.direction === 'long' ? 'sell' : 'buy';
    let cursor: string | undefined;
    const maxPages = 8;
    let hasMarkerWithExpectedCloseSide = false;
    for (let page = 0; page < maxPages; page += 1) {
      const res = await this.rateLimit.runBybitCall(() =>
        params.client.getExecutionList({
          category: 'linear',
          symbol: params.symbol,
          limit: 50,
          cursor,
        }),
      );
      if (res.retCode !== 0) {
        break;
      }
      const list = res.result?.list ?? [];
      for (const ex of list) {
        const row = ex as unknown as Record<string, unknown>;
        const ts = Number(row.execTime ?? 0);
        if (!Number.isFinite(ts) || ts < createdFloorMs) continue;
        if (closedCeilMs !== undefined && ts > closedCeilMs) continue;
        if (!isLiquidationExecutionRow(row)) continue;
        const rowOrderId = String(row.orderId ?? '').trim();
        if (rowOrderId && params.trackedOrderIds.has(rowOrderId)) {
          return true;
        }
        const side = String(row.side ?? '').trim().toLowerCase();
        if (side === expectedCloseSide) {
          hasMarkerWithExpectedCloseSide = true;
        }
      }
      cursor = res.result?.nextPageCursor || undefined;
      if (!cursor || list.length === 0) {
        break;
      }
    }
    return hasMarkerWithExpectedCloseSide;
  }

  async getTradePnlBreakdown(params: {
    signalId: string;
    getSignalWithOrders: (signalId: string) => Promise<{
      id: string;
      pair: string;
      direction: string;
      createdAt: Date;
      closedAt?: Date | null;
      realizedPnl?: number | null;
      orders: { bybitOrderId: string | null }[];
    } | null>;
    getClient: () => Promise<RestClientV5 | null>;
  }): Promise<TradePnlBreakdownResult> {
    const signal = await params.getSignalWithOrders(params.signalId);
    if (!signal) {
      return {
        ok: false,
        signalId: params.signalId,
        source: 'unavailable',
        requestWindow: { startTime: 0, endTime: 0 },
        finalPnl: null,
        grossPnl: null,
        fees: { openFee: null, closeFee: null, execFee: null, total: null },
        error: 'Сделка не найдена',
      };
    }

    const requestWindow = this.buildClosedPnlWindow(signal.createdAt, signal.closedAt);
    const client = await params.getClient();
    if (!client) {
      return {
        ok: false,
        signalId: params.signalId,
        source: 'unavailable',
        requestWindow,
        finalPnl: signal.realizedPnl ?? null,
        grossPnl: null,
        fees: { openFee: null, closeFee: null, execFee: null, total: null },
        error: 'Нет подключенных ключей Bybit',
      };
    }

    const symbol = normalizeTradingPair(signal.pair);
    const ourIds = new Set<string>(
      signal.orders
        .map((o) => (o.bybitOrderId ? String(o.bybitOrderId) : ''))
        .filter((id): id is string => id.length > 0),
    );
    if (ourIds.size === 0) {
      return {
        ok: false,
        signalId: params.signalId,
        source: 'unavailable',
        requestWindow,
        finalPnl: signal.realizedPnl ?? null,
        grossPnl: null,
        fees: { openFee: null, closeFee: null, execFee: null, total: null },
        details: 'Нет bybitOrderId у ордеров сделки',
      };
    }

    try {
      const rows = await this.fetchClosedPnlRowsForSymbol(
        client,
        symbol,
        requestWindow.startTime,
        requestWindow.endTime,
      );
      const parsed = this.sumClosedPnlForSignal(
        rows,
        ourIds,
        signal.direction,
        signal.createdAt,
        signal.closedAt,
      );
      if (parsed.hadParsedPnl) {
        return {
          ok: true,
          signalId: params.signalId,
          source: 'closed_pnl',
          requestWindow,
          finalPnl: parsed.totalPnl,
          grossPnl: parsed.grossPnl,
          fees: {
            openFee: parsed.openFee,
            closeFee: parsed.closeFee,
            execFee: parsed.execFee,
            total: parsed.totalFee,
          },
        };
      }

      const fallback = await this.estimateClosedPnlFromExecutions({
        client,
        symbol,
        direction: signal.direction,
        createdAt: signal.createdAt,
        closedAt: signal.closedAt,
      });
      if (fallback) {
        return {
          ok: true,
          signalId: params.signalId,
          source: 'execution_fallback',
          requestWindow,
          finalPnl: fallback.netPnl,
          grossPnl: fallback.grossPnl,
          fees: {
            openFee: null,
            closeFee: null,
            execFee: fallback.totalFees,
            total: fallback.totalFees,
          },
          details: 'Расчёт по execution list (fallback)',
        };
      }

      return {
        ok: false,
        signalId: params.signalId,
        source: 'unavailable',
        requestWindow,
        finalPnl: signal.realizedPnl ?? null,
        grossPnl: null,
        fees: { openFee: null, closeFee: null, execFee: null, total: null },
        details: 'Не удалось получить комиссии и PnL из Bybit',
      };
    } catch (e) {
      return {
        ok: false,
        signalId: params.signalId,
        source: 'unavailable',
        requestWindow,
        finalPnl: signal.realizedPnl ?? null,
        grossPnl: null,
        fees: { openFee: null, closeFee: null, execFee: null, total: null },
        error: formatError(e),
      };
    }
  }
}
