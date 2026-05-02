import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { AppLogService } from '../app-log/app-log.service';
import { OrdersService } from '../orders/orders.service';
import { BybitBalanceInstrumentService } from './bybit-balance-instrument.service';
import { BybitExposureService } from './bybit-exposure.service';
import { BybitNotifyService } from './bybit-notify.service';
import { BybitPlacementValidationService } from './bybit-placement-validation.service';
import { BybitPositionCloseService } from './bybit-position-close.service';
import { isFilledOrderStatus } from './bybit-order-status.util';
import type { CloseSignalResult } from './bybit.types';

@Injectable()
export class BybitExchangeCleanupService {
  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    private readonly bybitNotify: BybitNotifyService,
    private readonly balanceInstrument: BybitBalanceInstrumentService,
    private readonly bybitExposure: BybitExposureService,
    private readonly placementValidation: BybitPlacementValidationService,
    private readonly bybitPositionClose: BybitPositionCloseService,
  ) {}

  /**
   * Перед удалением сделки в статусе ORDERS_PLACED: отмена ордеров и закрытие позиции на Bybit.
   */
  async cleanupExchangeBeforeDeletingPlacedSignal(
    signalId: string,
  ): Promise<CloseSignalResult> {
    const signal = await this.orders.getSignalWithOrders(signalId);
    if (!signal) {
      return { ok: false, error: 'Сигнал не найден' };
    }

    const symbol = normalizeTradingPair(signal.pair);
    const client = await this.balanceInstrument.getClient();
    if (!client) {
      return {
        ok: false,
        signalId,
        symbol,
        error:
          'Нет подключенных ключей Bybit. Настройте BYBIT_API_KEY/BYBIT_API_SECRET.',
      };
    }

    const flatResult = await this.flattenLinearSymbolOnExchange(client, symbol);
    if (!flatResult.ok) {
      if (flatResult.pendingExchange) {
        await this.orders.createSignalEvent(
          signalId,
          'BYBIT_TRADE_DELETE_CLEANUP_PENDING',
          {
            symbol,
            activeOrders: flatResult.activeOrders,
            positions: flatResult.positions,
            cancelledOrders: flatResult.cancelledOrders,
            closedPositions: flatResult.closedPositions,
          },
        );
        void this.appLog.append('warn', 'bybit', 'trade delete: exchange cleanup pending', {
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
        await this.orders.createSignalEvent(
          signalId,
          'BYBIT_TRADE_DELETE_CLEANUP_FAILED',
          {
            symbol,
            errors: errParts.length > 0 ? errParts : [flatResult.details],
            cancelledOrders: flatResult.cancelledOrders,
            closedPositions: flatResult.closedPositions,
          },
        );
        void this.appLog.append('error', 'bybit', 'trade delete: exchange cleanup failed', {
          signalId,
          symbol,
          details: flatResult.details,
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

    for (const ord of signal.orders) {
      if (isFilledOrderStatus(ord.status)) {
        continue;
      }
      await this.orders.updateOrder(ord.id, {
        status: 'CANCELLED_MANUAL',
      });
    }

    await this.orders.createSignalEvent(signalId, 'BYBIT_TRADE_DELETE_CLEANUP_SUCCESS', {
      symbol,
      cancelledOrders: flatResult.cancelledOrders,
      closedPositions: flatResult.closedPositions,
      deletedAt: new Date().toISOString(),
    });
    void this.appLog.append('info', 'bybit', 'trade delete: exchange cleanup ok', {
      signalId,
      symbol,
      cancelledOrders: flatResult.cancelledOrders,
      closedPositions: flatResult.closedPositions,
    });
    await this.bybitNotify.notifyApiTradeCancelled(signal, 'Удаление сделки');

    return {
      ok: true,
      signalId,
      symbol,
      cancelledOrders: flatResult.cancelledOrders,
      closedPositions: flatResult.closedPositions,
    };
  }

  async flattenLinearSymbolOnExchange(
    client: RestClientV5,
    symbol: string,
  ) {
    return this.bybitPositionClose.flattenLinearSymbolOnExchange(client, symbol, {
      appLog: this.appLog,
      getExchangePositions: (c, s) => this.bybitExposure.getExchangePositions(c, s),
      getLotStep: (c, s) => this.balanceInstrument.getLotStep(c, s),
      formatQtyToStep: (qty, qtyStep) =>
        this.placementValidation.formatQtyToStep(qty, qtyStep),
      waitForSymbolToBeFlat: (c, s, timeoutMs, pollMs) =>
        this.waitForSymbolToBeFlat(c, s, timeoutMs, pollMs),
    });
  }

  private async waitForSymbolToBeFlat(
    client: RestClientV5,
    symbol: string,
    timeoutMs = 10_000,
    pollMs = 1_000,
  ): Promise<{ ok: true } | { ok: false; activeOrders: number; positions: number }> {
    const deadline = Date.now() + timeoutMs;
    let lastActiveOrders = 0;
    let lastPositions = 0;

    while (Date.now() <= deadline) {
      const [activeOrders, positions] = await Promise.all([
        this.bybitExposure.getExchangeActiveOrders(client, symbol),
        this.bybitExposure.getExchangePositions(client, symbol),
      ]);
      lastActiveOrders = activeOrders.length;
      lastPositions = positions.length;
      if (lastActiveOrders === 0 && lastPositions === 0) {
        return { ok: true };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return {
      ok: false,
      activeOrders: lastActiveOrders,
      positions: lastPositions,
    };
  }
}
