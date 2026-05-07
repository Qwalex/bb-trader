import { Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { BybitRateLimitService } from '../instrument/bybit-rate-limit.service';
import { BYBIT_OPEN_ORDER_STATUSES } from '../bybit.constants';
import { isReduceOnlyOrClosingOrder } from './bybit-exposure.util';
import type { LiveExposureOrder, LiveExposurePosition } from '../types/bybit.types';

@Injectable()
export class BybitExposureService {
  private readonly logger = new Logger(BybitExposureService.name);

  constructor(private readonly rateLimit: BybitRateLimitService) {}

  private isOpenOrderStatus(status: string | null | undefined): boolean {
    const normalized = (status ?? '').trim().toLowerCase();
    return Array.from(BYBIT_OPEN_ORDER_STATUSES).some(
      (s) => s.toLowerCase() === normalized,
    );
  }

  async hasExchangeExposureForDirection(
    client: RestClientV5,
    symbol: string,
    direction: 'long' | 'short',
  ): Promise<boolean> {
    const verdict = await this.getExchangeExposureVerdict(client, symbol, direction);
    return verdict !== 'flat';
  }

  /**
   * Важно: при ошибках API возвращаем `unknown`, а не `flat`,
   * чтобы не закрывать сигналы на ложной "чистой бирже".
   */
  async getExchangeExposureVerdict(
    client: RestClientV5,
    symbol: string,
    direction: 'long' | 'short',
  ): Promise<'exposed' | 'flat' | 'unknown'> {
    const minPos = 1e-12;
    const wantBuy = direction === 'long';

    const orderFilters = ['Order', 'StopOrder'] as const;
    for (const orderFilter of orderFilters) {
      try {
        let cursor: string | undefined;
        do {
          const ao = await this.rateLimit.runBybitCall(() =>
            client.getActiveOrders({
              category: 'linear',
              symbol,
              openOnly: 0,
              limit: 50,
              orderFilter,
              cursor,
            }),
          );
          if (ao.retCode !== 0) {
            this.logger.debug(
              `getActiveOrders ${orderFilter} retCode=${ao.retCode} ${ao.retMsg}`,
            );
            return 'unknown';
          }
          const list = ao.result?.list ?? [];
          for (const o of list) {
            if (!BYBIT_OPEN_ORDER_STATUSES.has(o.orderStatus)) {
              continue;
            }
            if (isReduceOnlyOrClosingOrder(o)) {
              continue;
            }
            const side = String(o.side ?? '').toLowerCase();
            const isBuy = side === 'buy';
            if (wantBuy === isBuy) {
              this.logger.debug(
                `getExchangeExposureVerdict(${direction}): open order ${o.orderId} status=${o.orderStatus} filter=${orderFilter}`,
              );
              return 'exposed';
            }
          }
          cursor = ao.result?.nextPageCursor || undefined;
        } while (cursor);
      } catch (e) {
        if (this.rateLimit.isRateLimitError(e)) {
          throw e;
        }
        this.logger.debug(`getActiveOrders ${orderFilter}: ${formatError(e)}`);
        return 'unknown';
      }
    }

    try {
      const pos = await this.rateLimit.runBybitCall(() =>
        client.getPositionInfo({
          category: 'linear',
          symbol,
        }),
      );
      if (pos.retCode === 0) {
        const rows = pos.result?.list ?? [];
        for (const row of rows) {
          const size = row?.size ? Math.abs(parseFloat(String(row.size))) : 0;
          if (size <= minPos) {
            continue;
          }
          const side = String(row.side ?? '').toLowerCase();
          const isBuy = side === 'buy';
          if (wantBuy === isBuy) {
            this.logger.debug(
              `getExchangeExposureVerdict(${direction}): position idx=${row.positionIdx} size=${row.size}`,
            );
            return 'exposed';
          }
        }
      } else {
        this.logger.debug(
          `getPositionInfo symbol=${symbol} retCode=${pos.retCode} ${pos.retMsg}`,
        );
      }
    } catch (e) {
      if (this.rateLimit.isRateLimitError(e)) {
        throw e;
      }
      this.logger.debug(`getPositionInfo symbol=${symbol}: ${formatError(e)}`);
      return 'unknown';
    }

    try {
      let cursor: string | undefined;
      do {
        const pos = await this.rateLimit.runBybitCall(() =>
          client.getPositionInfo({
            category: 'linear',
            settleCoin: 'USDT',
            limit: 50,
            cursor,
          }),
        );
        if (pos.retCode !== 0) {
          this.logger.debug(
            `getPositionInfo settleCoin scan retCode=${pos.retCode} ${pos.retMsg}`,
          );
          return 'unknown';
        }
        const rows = pos.result?.list ?? [];
        for (const row of rows) {
          if (normalizeTradingPair(row.symbol) !== symbol) {
            continue;
          }
          const size = row?.size ? Math.abs(parseFloat(String(row.size))) : 0;
          if (size <= minPos) {
            continue;
          }
          const side = String(row.side ?? '').toLowerCase();
          const isBuy = side === 'buy';
          if (wantBuy === isBuy) {
            this.logger.debug(
              `getExchangeExposureVerdict(${direction}): USDT scan match ${row.symbol} size=${row.size}`,
            );
            return 'exposed';
          }
        }
        cursor = pos.result?.nextPageCursor || undefined;
      } while (cursor);
    } catch (e) {
      if (this.rateLimit.isRateLimitError(e)) {
        throw e;
      }
      this.logger.debug(`getPositionInfo settleCoin scan: ${formatError(e)}`);
      return 'unknown';
    }

    return 'flat';
  }

  async getExchangeActiveOrders(
    client: RestClientV5,
    symbol: string,
  ): Promise<LiveExposureOrder[]> {
    const orderFilters = ['Order', 'StopOrder'] as const;
    const byId = new Map<string, LiveExposureOrder>();

    for (const orderFilter of orderFilters) {
      let cursor: string | undefined;
      do {
        const res = await this.rateLimit.runBybitCall(() =>
          client.getActiveOrders({
            category: 'linear',
            symbol,
            openOnly: 0,
            orderFilter,
            limit: 50,
            cursor,
          }),
        );
        if (res.retCode !== 0) {
          break;
        }
        for (const o of res.result?.list ?? []) {
          if (!this.isOpenOrderStatus(o.orderStatus)) {
            continue;
          }
          const orderId = String(o.orderId ?? '');
          if (!orderId) {
            continue;
          }
          byId.set(orderId, {
            orderId,
            side: String(o.side ?? ''),
            type: String(o.orderType ?? ''),
            status: String(o.orderStatus ?? ''),
            price: o.price !== undefined && o.price !== '' ? Number(o.price) : null,
            qty: o.qty !== undefined && o.qty !== '' ? Number(o.qty) : null,
            reduceOnly: Boolean(o.reduceOnly),
          });
        }
        cursor = res.result?.nextPageCursor || undefined;
      } while (cursor);
    }

    return Array.from(byId.values());
  }

  async getExchangePositions(
    client: RestClientV5,
    symbol: string,
  ): Promise<LiveExposurePosition[]> {
    const res = await this.rateLimit.runBybitCall(() =>
      client.getPositionInfo({
        category: 'linear',
        symbol,
      }),
    );
    if (res.retCode !== 0) {
      return [];
    }
    const out: LiveExposurePosition[] = [];
    for (const row of res.result?.list ?? []) {
      const size = row?.size ? Math.abs(parseFloat(String(row.size))) : 0;
      if (!Number.isFinite(size) || size <= 1e-12) {
        continue;
      }
      out.push({
        side: String(row.side ?? ''),
        size,
        entryPrice:
          row.avgPrice !== undefined && row.avgPrice !== '' ? Number(row.avgPrice) : null,
        markPrice:
          row.markPrice !== undefined && row.markPrice !== '' ? Number(row.markPrice) : null,
        unrealizedPnl:
          row.unrealisedPnl !== undefined && row.unrealisedPnl !== ''
            ? Number(row.unrealisedPnl)
            : null,
        positionIdx: Number(row.positionIdx ?? 0),
      });
    }
    return out;
  }

  pickLiveExposurePositionForDirection(
    positions: LiveExposurePosition[],
    direction: 'long' | 'short',
  ): LiveExposurePosition | undefined {
    const wantSide = direction === 'long' ? 'buy' : 'sell';
    const matched = positions.find(
      (row) => String(row.side ?? '').trim().toLowerCase() === wantSide,
    );
    if (matched) {
      return matched;
    }
    if (positions.length === 1) {
      const only = positions[0];
      const side = String(only?.side ?? '').trim().toLowerCase();
      if (side === 'buy' || side === 'sell') {
        return undefined;
      }
      return only;
    }
    return undefined;
  }
}
