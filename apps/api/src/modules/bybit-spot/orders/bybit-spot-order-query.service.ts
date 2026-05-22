import { Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { BybitRateLimitService } from '../../bybit/instrument/bybit-rate-limit.service';
import {
  isFilledOrderStatus,
  isOpenOrderStatus,
} from '../../bybit/orders/bybit-order-status.util';

export type SpotOrderSnapshot = {
  status: string;
  cumExecQty: number;
  avgPrice: number | null;
  cumExecValue: number | null;
};

@Injectable()
export class BybitSpotOrderQueryService {
  private readonly logger = new Logger(BybitSpotOrderQueryService.name);

  constructor(private readonly rateLimit: BybitRateLimitService) {}

  async fetchSpotOrderSnapshot(
    client: RestClientV5,
    symbol: string,
    orderId: string,
  ): Promise<SpotOrderSnapshot | undefined> {
    const sym = normalizeTradingPair(symbol);
    try {
      const res = await this.rateLimit.runBybitCall(() =>
        client.getActiveOrders({
          category: 'spot',
          symbol: sym,
          orderId,
        }),
      );
      if (res.retCode !== 0) {
        const hist = await this.rateLimit.runBybitCall(() =>
          client.getHistoricOrders({
            category: 'spot',
            symbol: sym,
            orderId,
            limit: 1,
          }),
        );
        if (hist.retCode !== 0) {
          return undefined;
        }
        const row = hist.result?.list?.[0];
        if (!row) {
          return undefined;
        }
        return this.mapRow(row);
      }
      const row = res.result?.list?.[0];
      if (!row) {
        return undefined;
      }
      return this.mapRow(row);
    } catch (e) {
      this.logger.debug(`fetchSpotOrderSnapshot ${orderId}: ${formatError(e)}`);
      return undefined;
    }
  }

  private mapRow(row: {
    orderStatus?: string;
    cumExecQty?: string;
    avgPrice?: string;
    cumExecValue?: string;
  }): SpotOrderSnapshot {
    const cumExecQty = parseFloat(String(row.cumExecQty ?? 0));
    const avgPriceRaw = parseFloat(String(row.avgPrice ?? ''));
    const cumExecValueRaw = parseFloat(String(row.cumExecValue ?? ''));
    return {
      status: String(row.orderStatus ?? ''),
      cumExecQty: Number.isFinite(cumExecQty) ? cumExecQty : 0,
      avgPrice: Number.isFinite(avgPriceRaw) && avgPriceRaw > 0 ? avgPriceRaw : null,
      cumExecValue:
        Number.isFinite(cumExecValueRaw) && cumExecValueRaw > 0 ? cumExecValueRaw : null,
    };
  }

  mapSpotStatusForDb(status: string): string {
    const s = status.trim();
    if (!s) {
      return 'UNKNOWN';
    }
    if (isFilledOrderStatus(s)) {
      return 'Filled';
    }
    if (isOpenOrderStatus(s)) {
      return s;
    }
    return s;
  }

  async hasOpenSpotOrders(client: RestClientV5, symbol: string): Promise<boolean> {
    const sym = normalizeTradingPair(symbol);
    try {
      const res = await this.rateLimit.runBybitCall(() =>
        client.getActiveOrders({
          category: 'spot',
          symbol: sym,
          openOnly: 0,
          limit: 20,
        }),
      );
      if (res.retCode !== 0) {
        return false;
      }
      return (res.result?.list ?? []).some((row) =>
        isOpenOrderStatus(String(row.orderStatus ?? '')),
      );
    } catch {
      return false;
    }
  }
}
