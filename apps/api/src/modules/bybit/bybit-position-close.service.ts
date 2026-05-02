import { Injectable } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { formatError } from '../../common/format-error';
import type { BybitPositionClosePorts } from './bybit-ports.types';
import type { CloseSignalResult } from './bybit.types';

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
          const res = await client.cancelAllOrders({
            category: 'linear',
            symbol,
            orderFilter,
          });
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
          const res = await client.submitOrder({
            category: 'linear',
            symbol,
            side: closeSide,
            orderType: 'Market',
            qty,
            reduceOnly: true,
            closeOnTrigger: true,
            positionIdx: (p.positionIdx as 0 | 1 | 2) ?? 0,
          });
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

    const flatResult = await ports.flattenLinearSymbolOnExchange(client, symbol);
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
