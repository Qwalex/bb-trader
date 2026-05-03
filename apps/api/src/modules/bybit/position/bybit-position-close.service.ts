import { Injectable } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { formatError } from '../../../common/format-error';
import { BybitRateLimitService } from '../instrument/bybit-rate-limit.service';
import type { BybitPositionClosePorts } from '../types/bybit-ports.types';
import type { CloseSignalResult } from '../types/bybit.types';
import { pickLiveExposurePositionForDirection } from './bybit-position-pick.util';

type FlattenResult =
  | { ok: true; cancelledOrders: number; closedPositions: number }
  | {
      ok: false;
      cancelledOrders: number;
      closedPositions: number;
      error: string;
      details: string;
      pendingExchange: boolean;
      activeOrders?: number;
      positions?: number;
    };

@Injectable()
export class BybitPositionCloseService {
  constructor(private readonly rateLimit: BybitRateLimitService) {}

  private isFinalOrderStatus(status: string | null | undefined): boolean {
    const normalized = (status ?? '').trim().toLowerCase();
    return (
      normalized === 'filled' ||
      normalized === 'cancelled' ||
      normalized === 'canceled' ||
      normalized === 'deactivated' ||
      normalized === 'rejected'
    );
  }

  async flattenLinearSymbolOnExchange(
    client: RestClientV5,
    symbol: string,
    ports: {
      appLog: { append: (...args: any[]) => Promise<void> | void };
      getExchangePositions: (client: RestClientV5, symbol: string) => Promise<
        Array<{ side: string; size: number; positionIdx: number }>
      >;
      getLotStep: (
        client: RestClientV5,
        symbol: string,
      ) => Promise<{ qtyStep: string }>;
      formatQtyToStep: (qty: number, qtyStep: string) => string;
      waitForSymbolToBeFlat: (
        client: RestClientV5,
        symbol: string,
        timeoutMs?: number,
        pollMs?: number,
      ) => Promise<{ ok: true } | { ok: false; activeOrders: number; positions: number }>;
    },
  ): Promise<FlattenResult> {
    const errors: string[] = [];
    let cancelledOrders = 0;
    let closedPositions = 0;
    const maxRounds = 4;
    const settleWaitMs = 1_200;

    for (let round = 1; round <= maxRounds; round += 1) {
      const orderFilters = ['Order', 'StopOrder'] as const;
      for (const orderFilter of orderFilters) {
        try {
          const res = await this.rateLimit.runBybitCall(() =>
            client.cancelAllOrders({
              category: 'linear',
              symbol,
              orderFilter,
            }),
          );
          if (res.retCode !== 0) {
            errors.push(
              `[round ${round}] cancelAllOrders(${orderFilter}) retCode=${res.retCode} ${String(res.retMsg ?? '')}`,
            );
            continue;
          }
          cancelledOrders += res.result?.list?.length ?? 0;
        } catch (e) {
          errors.push(`[round ${round}] cancelAllOrders(${orderFilter}) ${formatError(e)}`);
        }
      }

      try {
        const positions = await ports.getExchangePositions(client, symbol);
        for (const p of positions) {
          const closeSide = p.side === 'Buy' ? 'Sell' : 'Buy';
          const qty = ports.formatQtyToStep(
            p.size,
            (await ports.getLotStep(client, symbol)).qtyStep,
          );
          if (!qty || parseFloat(qty) <= 0) {
            continue;
          }
          const res = await this.rateLimit.runBybitCall(() =>
            client.submitOrder({
              category: 'linear',
              symbol,
              side: closeSide,
              orderType: 'Market',
              qty,
              reduceOnly: true,
              closeOnTrigger: true,
              positionIdx: (p.positionIdx as 0 | 1 | 2) ?? 0,
            }),
          );
          if (res.retCode !== 0) {
            errors.push(
              `[round ${round}] submit close Market retCode=${res.retCode} ${String(res.retMsg ?? '')}`,
            );
            continue;
          }
          closedPositions += 1;
        }
      } catch (e) {
        errors.push(`[round ${round}] close positions ${formatError(e)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, settleWaitMs));
      const flatState = await ports.waitForSymbolToBeFlat(client, symbol, 8_000, 800);
      if (flatState.ok) {
        return { ok: true, cancelledOrders, closedPositions };
      }

      if (round < maxRounds) {
        void ports.appLog.append(
          'warn',
          'bybit',
          'flatten: symbol not flat after round, retrying',
          {
            symbol,
            round,
            activeOrders: flatState.activeOrders,
            positions: flatState.positions,
          },
        );
      } else {
        return {
          ok: false,
          cancelledOrders,
          closedPositions,
          error: 'Bybit ещё не подтвердил полное закрытие ордеров/позиции',
          details: `activeOrders=${flatState.activeOrders}; positions=${flatState.positions}`,
          pendingExchange: true,
          activeOrders: flatState.activeOrders,
          positions: flatState.positions,
        };
      }
    }

    if (errors.length > 0) {
      return {
        ok: false,
        cancelledOrders,
        closedPositions,
        error: 'Не удалось полностью закрыть на Bybit',
        details: errors.join(' | '),
        pendingExchange: false,
      };
    }

    return { ok: true, cancelledOrders, closedPositions };
  }

  private async cancelTrackedSignalOrders(
    client: RestClientV5,
    symbol: string,
    signal: {
      orders: Array<{
        bybitOrderId: string | null;
        status: string | null;
      }>;
    },
  ): Promise<{ cancelledOrders: number; errors: string[] }> {
    const errors: string[] = [];
    let cancelledOrders = 0;
    const orderIds = Array.from(
      new Set(
        signal.orders
          .filter((ord) => !this.isFinalOrderStatus(ord.status))
          .map((ord) => ord.bybitOrderId?.trim() ?? '')
          .filter((id) => id.length > 0),
      ),
    );

    for (const orderId of orderIds) {
      let cancelled = false;
      for (const orderFilter of ['Order', 'StopOrder'] as const) {
        try {
          const res = await this.rateLimit.runBybitCall(() =>
            client.cancelOrder({
              category: 'linear',
              symbol,
              orderId,
              orderFilter,
            }),
          );
          if (res.retCode === 0 || res.retCode === 110008) {
            cancelled = true;
            if (res.retCode === 0) {
              cancelledOrders += 1;
            }
            break;
          }
          if (res.retCode === 110001 && orderFilter === 'Order') {
            continue;
          }
          if (res.retCode === 110001 && orderFilter === 'StopOrder') {
            cancelled = true;
            break;
          }
          if (orderFilter === 'StopOrder') {
            errors.push(
              `cancelOrder(${orderId}) retCode=${res.retCode} ${String(res.retMsg ?? '')}`,
            );
          }
        } catch (e) {
          if (orderFilter === 'StopOrder') {
            errors.push(`cancelOrder(${orderId}) ${formatError(e)}`);
          }
        }
      }
      if (!cancelled) {
        errors.push(`cancelOrder(${orderId}) не подтвердил отмену`);
      }
    }

    return { cancelledOrders, errors };
  }

  private async countLiveTrackedOrders(
    client: RestClientV5,
    symbol: string,
    signal: {
      pair: string;
      orders: Array<{
        bybitOrderId: string | null;
        qty: number | null;
      }>;
    },
    ports: BybitPositionClosePorts,
  ): Promise<number> {
    const trackedIds = Array.from(
      new Set(
        signal.orders
          .map((ord) => ord.bybitOrderId?.trim() ?? '')
          .filter((id) => id.length > 0),
      ),
    );
    if (trackedIds.length === 0) {
      return 0;
    }

    const activeIds = new Set(
      (await ports.getExchangeActiveOrders(client, symbol)).map((ord) => String(ord.orderId ?? '')),
    );
    let live = 0;
    for (const orderId of trackedIds) {
      if (activeIds.has(orderId)) {
        live += 1;
        continue;
      }
      const dbOrder = signal.orders.find((ord) => ord.bybitOrderId === orderId);
      const status = await ports.fetchOrderStatusFromExchange(
        client,
        signal.pair,
        orderId,
        dbOrder?.qty != null ? Number(dbOrder.qty) : undefined,
      );
      if (ports.isOpenOrderStatus(status)) {
        live += 1;
      }
    }
    return live;
  }

  private async waitForSignalSideCleanup(
    client: RestClientV5,
    symbol: string,
    direction: 'long' | 'short',
    signal: {
      pair: string;
      orders: Array<{
        bybitOrderId: string | null;
        qty: number | null;
      }>;
    },
    ports: BybitPositionClosePorts,
    timeoutMs = 10_000,
    pollMs = 1_000,
  ): Promise<{ ok: true } | { ok: false; activeOrders: number; positions: number }> {
    const deadline = Date.now() + timeoutMs;
    let lastActiveOrders = 0;
    let lastPositions = 0;

    while (Date.now() <= deadline) {
      const [activeOrders, positions] = await Promise.all([
        this.countLiveTrackedOrders(client, symbol, signal, ports),
        ports.getExchangePositions(client, symbol),
      ]);
      const sidePosition = pickLiveExposurePositionForDirection(positions, direction);
      lastActiveOrders = activeOrders;
      lastPositions = sidePosition ? 1 : 0;
      if (lastActiveOrders === 0 && lastPositions === 0) {
        return { ok: true };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return { ok: false, activeOrders: lastActiveOrders, positions: lastPositions };
  }

  async closeSignalSideOnExchange(
    client: RestClientV5,
    symbol: string,
    direction: 'long' | 'short',
    signal: {
      pair: string;
      orders: Array<{
        bybitOrderId: string | null;
        status: string | null;
        qty: number | null;
      }>;
    },
    ports: BybitPositionClosePorts,
  ): Promise<FlattenResult> {
    const errors: string[] = [];
    let closedPositions = 0;
    const { qtyStep } = await ports.getLotStep(client, symbol);
    const cancelResult = await this.cancelTrackedSignalOrders(client, symbol, signal);
    const cancelledOrders = cancelResult.cancelledOrders;
    errors.push(...cancelResult.errors);

    try {
      const positions = await ports.getExchangePositions(client, symbol);
      const p = pickLiveExposurePositionForDirection(positions, direction);
      if (p) {
        const closeSide = direction === 'long' ? 'Sell' : 'Buy';
        const qty = ports.formatQtyToStep(p.size, qtyStep);
        if (qty && parseFloat(qty) > 0) {
          const res = await this.rateLimit.runBybitCall(() =>
            client.submitOrder({
              category: 'linear',
              symbol,
              side: closeSide,
              orderType: 'Market',
              qty,
              reduceOnly: true,
              closeOnTrigger: true,
              positionIdx: (p.positionIdx as 0 | 1 | 2) ?? 0,
            }),
          );
          if (res.retCode !== 0) {
            errors.push(
              `submit close ${direction} retCode=${res.retCode} ${String(res.retMsg ?? '')}`,
            );
          } else {
            closedPositions += 1;
          }
        }
      }
    } catch (e) {
      errors.push(`close ${direction} position ${formatError(e)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const flatState = await this.waitForSignalSideCleanup(
      client,
      symbol,
      direction,
      signal,
      ports,
      8_000,
      800,
    );
    if (flatState.ok) {
      return { ok: true, cancelledOrders, closedPositions };
    }

    if (errors.length > 0) {
      return {
        ok: false,
        cancelledOrders,
        closedPositions,
        error: 'Не удалось полностью закрыть сторону сделки на Bybit',
        details: errors.join(' | '),
        pendingExchange: false,
      };
    }

    return {
      ok: false,
      cancelledOrders,
      closedPositions,
      error: 'Bybit ещё не подтвердил закрытие стороны сделки',
      details: `activeOrders=${flatState.activeOrders}; positions=${flatState.positions}`,
      pendingExchange: true,
      activeOrders: flatState.activeOrders,
      positions: flatState.positions,
    };
  }

  async closeSignalManually(
    signalId: string,
    ports: BybitPositionClosePorts,
  ): Promise<CloseSignalResult> {
    const signal = await ports.orders.getSignalWithOrders(signalId);
    if (!signal) {
      return { ok: false, error: 'Сигнал не найден' };
    }

    const symbol = ports.normalizeTradingPair(signal.pair);
    const client = await ports.getClient();
    if (!client) {
      return {
        ok: false,
        signalId,
        symbol,
        error: 'Нет подключенных ключей Bybit. Настройте BYBIT_API_KEY/BYBIT_API_SECRET.',
      };
    }

    const direction = signal.direction === 'short' ? 'short' : 'long';
    const flatResult = await this.closeSignalSideOnExchange(
      client,
      symbol,
      direction,
      signal,
      ports,
    );
    if (!flatResult.ok) {
      if (flatResult.pendingExchange) {
        await ports.orders.createSignalEvent(signalId, 'BYBIT_CLOSE_PENDING', {
          symbol,
          activeOrders: flatResult.activeOrders,
          positions: flatResult.positions,
          cancelledOrders: flatResult.cancelledOrders,
          closedPositions: flatResult.closedPositions,
        });
        void ports.appLog.append('warn', 'bybit', 'manual close pending exchange cleanup', {
          signalId,
          symbol,
          activeOrders: flatResult.activeOrders,
          positions: flatResult.positions,
        });
      } else {
        const errParts = flatResult.details
          .split(' | ')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        await ports.orders.createSignalEvent(signalId, 'BYBIT_CLOSE_FAILED', {
          symbol,
          errors: errParts.length > 0 ? errParts : [flatResult.details],
          cancelledOrders: flatResult.cancelledOrders,
          closedPositions: flatResult.closedPositions,
        });
        void ports.appLog.append('error', 'bybit', 'manual close failed', {
          signalId,
          symbol,
          errors: errParts,
        });
      }
      return {
        ok: false,
        signalId,
        symbol,
        cancelledOrders: flatResult.cancelledOrders,
        closedPositions: flatResult.closedPositions,
        error: flatResult.error,
        details: flatResult.details,
      };
    }

    const cancelledOrders = flatResult.cancelledOrders;
    const closedPositions = flatResult.closedPositions;

    for (const ord of signal.orders) {
      if (ports.isFilledOrderStatus(ord.status)) {
        continue;
      }
      await ports.orders.updateOrder(ord.id, {
        status: 'CANCELLED_MANUAL',
      });
    }

    await ports.orders.updateSignalStatus(signalId, {
      status: 'CLOSED_MIXED',
      closedAt: new Date(),
      realizedPnl: null,
    });
    await ports.orders.createSignalEvent(signalId, 'BYBIT_CLOSE_SUCCESS', {
      symbol,
      cancelledOrders,
      closedPositions,
      closedAt: new Date().toISOString(),
    });

    void ports.appLog.append('info', 'bybit', 'manual close success', {
      signalId,
      symbol,
      cancelledOrders,
      closedPositions,
    });
    await ports.notifyApiTradeCancelled(signal, 'Отмена ордеров/позиции');

    return {
      ok: true,
      signalId,
      symbol,
      cancelledOrders,
      closedPositions,
    };
  }
}
