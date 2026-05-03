import { Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { BybitRateLimitService } from '../instrument/bybit-rate-limit.service';

@Injectable()
export class BybitOrderExchangeQueryService {
  private readonly logger = new Logger(BybitOrderExchangeQueryService.name);

  constructor(private readonly rateLimit: BybitRateLimitService) {}

  /**
   * Если история не отдаёт статус, смотрим исполнения: набрался ли объём по ордеру.
   */
  async inferFilledFromExecutions(
    client: RestClientV5,
    sym: string,
    orderId: string,
    expectedQty: number,
  ): Promise<boolean> {
    if (expectedQty <= 1e-12) {
      return false;
    }
    try {
      const res = await this.rateLimit.runBybitCall(() =>
        client.getExecutionList({
          category: 'linear',
          symbol: sym,
          orderId,
          limit: 50,
        }),
      );
      if (res.retCode !== 0) {
        return false;
      }
      let cum = 0;
      for (const ex of res.result?.list ?? []) {
        cum += parseFloat(String(ex.execQty ?? 0));
      }
      return cum >= expectedQty * 0.999;
    } catch (e) {
      if (this.rateLimit.isRateLimitError(e)) {
        throw e;
      }
      return false;
    }
  }

  /**
   * Актуальный статус ордера: realtime → history (UTA: settleCoin + orderFilter).
   * Если пусто — пробуем исполнения по orderId (часто так виден полный fill при задержке history).
   */
  async fetchOrderStatusFromExchange(
    client: RestClientV5,
    pair: string,
    orderId: string,
    expectedQty?: number,
  ): Promise<string | undefined> {
    return this.fetchOrderStatusFromExchangeCore(client, pair, orderId, expectedQty);
  }

  private async fetchOrderStatusFromExchangeCore(
    client: RestClientV5,
    pair: string,
    orderId: string,
    expectedQty?: number,
  ): Promise<string | undefined> {
    const sym = normalizeTradingPair(pair);
    const base = {
      category: 'linear' as const,
      symbol: sym,
      settleCoin: 'USDT' as const,
      orderFilter: 'Order' as const,
    };
    try {
      const active = await this.rateLimit.runBybitCall(() =>
        client.getActiveOrders({
          ...base,
          orderId,
          openOnly: 0,
          limit: 1,
        }),
      );
      if (active.retCode === 0 && (active.result?.list?.length ?? 0) > 0) {
        return active.result!.list![0]!.orderStatus;
      }
    } catch (e) {
      if (this.rateLimit.isRateLimitError(e)) {
        throw e;
      }
      this.logger.debug(`getActiveOrders ${orderId}: ${formatError(e)}`);
    }
    try {
      const hist = await this.rateLimit.runBybitCall(() =>
        client.getHistoricOrders({
          ...base,
          orderId,
          limit: 1,
        }),
      );
      if (hist.retCode === 0 && (hist.result?.list?.length ?? 0) > 0) {
        return hist.result!.list![0]!.orderStatus;
      }
    } catch (e) {
      if (this.rateLimit.isRateLimitError(e)) {
        throw e;
      }
      this.logger.debug(`getHistoricOrders ${orderId}: ${formatError(e)}`);
    }
    try {
      const histScan = await this.rateLimit.runBybitCall(() =>
        client.getHistoricOrders({
          ...base,
          limit: 50,
        }),
      );
      if (histScan.retCode === 0) {
        const row = histScan.result?.list?.find((o) => o.orderId === orderId);
        if (row?.orderStatus) {
          return row.orderStatus;
        }
        if (row) {
          const leaves = parseFloat(String(row.leavesQty ?? '1'));
          const cum = parseFloat(String(row.cumExecQty ?? '0'));
          if (leaves <= 1e-12 && cum > 0) {
            return 'Filled';
          }
        }
      }
    } catch (e) {
      if (this.rateLimit.isRateLimitError(e)) {
        throw e;
      }
      this.logger.debug(`getHistoricOrders scan ${orderId}: ${formatError(e)}`);
    }
    if (expectedQty !== undefined && expectedQty > 0) {
      const ok = await this.inferFilledFromExecutions(
        client,
        sym,
        orderId,
        expectedQty,
      );
      if (ok) {
        return 'Filled';
      }
    }
    return undefined;
  }

  async getExecutionSummary(
    client: RestClientV5,
    pair: string,
    orderId: string,
  ): Promise<{
    execQty: number;
    execValue: number;
    execCount: number;
    firstExecAt?: string;
    lastExecAt?: string;
  }> {
    const sym = normalizeTradingPair(pair);
    const res = await this.rateLimit.runBybitCall(() =>
      client.getExecutionList({
        category: 'linear',
        symbol: sym,
        orderId,
        limit: 50,
      }),
    );
    if (res.retCode !== 0) {
      return { execQty: 0, execValue: 0, execCount: 0 };
    }

    let execQty = 0;
    let execValue = 0;
    let firstExecAt: number | undefined;
    let lastExecAt: number | undefined;
    let execCount = 0;
    for (const ex of res.result?.list ?? []) {
      execCount += 1;
      execQty += parseFloat(String(ex.execQty ?? 0)) || 0;
      execValue += parseFloat(String(ex.execValue ?? 0)) || 0;
      const ms = Number(ex.execTime);
      if (Number.isFinite(ms) && ms > 0) {
        if (firstExecAt === undefined || ms < firstExecAt) {
          firstExecAt = ms;
        }
        if (lastExecAt === undefined || ms > lastExecAt) {
          lastExecAt = ms;
        }
      }
    }
    return {
      execQty,
      execValue,
      execCount,
      firstExecAt: firstExecAt ? new Date(firstExecAt).toISOString() : undefined,
      lastExecAt: lastExecAt ? new Date(lastExecAt).toISOString() : undefined,
    };
  }
}
