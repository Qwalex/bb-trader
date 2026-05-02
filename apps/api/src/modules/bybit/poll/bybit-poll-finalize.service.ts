import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { AppLogService } from '../../app-log/app-log.service';
import { OrdersService } from '../../orders/orders.service';
import { isClosedPnlLiquidationRow as isClosedPnlLiquidationRowUtil } from '../pnl/bybit-pnl.util';
import { BybitExposureService } from '../exposure/bybit-exposure.service';
import { BybitNotifyService } from '../notify/bybit-notify.service';
import { BybitPnlService } from '../pnl/bybit-pnl.service';
import { hasOpenEntryOrders, isFilledOrderStatus } from '../orders/bybit-order-status.util';
import { pickLiveExposurePositionForDirection } from '../position/bybit-position-pick.util';

@Injectable()
export class BybitPollFinalizeService {
  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly bybitExposure: BybitExposureService,
    private readonly bybitPnl: BybitPnlService,
    private readonly bybitNotify: BybitNotifyService,
    private readonly appLog: AppLogService,
  ) {}

  async finalizeSignalCloseIfNeeded(
    client: RestClientV5,
    fresh: {
      id: string;
      pair: string;
      direction: string;
      status: string;
      createdAt: Date;
      leverage?: number;
      source?: string | null;
      orders: { status: string | null; bybitOrderId?: string | null }[];
    },
  ): Promise<void> {
    const symNorm = normalizeTradingPair(fresh.pair);
    const livePositions = await this.bybitExposure.getExchangePositions(client, symNorm);
    const mainPosition = pickLiveExposurePositionForDirection(
      livePositions,
      fresh.direction as 'long' | 'short',
    );
    const posSize = mainPosition ? Math.abs(mainPosition.size) : 0;
    const hadFill = fresh.orders.some((o) => isFilledOrderStatus(o.status));
    if (!(hadFill && posSize === 0 && fresh.status === 'ORDERS_PLACED')) {
      return;
    }

    void this.appLog.append(
      'debug',
      'bybit',
      'poll: no live position for signal direction before close candidate evaluation',
      {
        signalId: fresh.id,
        pair: symNorm,
        direction: fresh.direction,
        hadFill,
        positionSnapshot: livePositions.map((row) => ({
          side: row.side,
          size: row.size,
          positionIdx: row.positionIdx,
          entryPrice: row.entryPrice,
        })),
      },
    );
    const ourIds = new Set<string>(
      fresh.orders
        .map((o) => (o.bybitOrderId ? String(o.bybitOrderId) : ''))
        .filter((id: string): id is string => id.length > 0),
    );
    const levRaw = fresh.leverage;
    const liquidationLeverage =
      levRaw != null && Number.isFinite(levRaw) ? Math.max(1, Math.round(levRaw)) : null;
    const notifyLeverage =
      liquidationLeverage ??
      (levRaw != null && Number.isFinite(levRaw) ? Math.max(1, Math.round(levRaw)) : 1);
    const requestWindow = this.bybitPnl.buildClosedPnlWindow(fresh.createdAt, new Date());
    const rows = await this.bybitPnl.fetchClosedPnlRowsForSymbol(
      client,
      symNorm,
      requestWindow.startTime,
      requestWindow.endTime,
    );
    const isLiquidationByClosedPnl = rows.some((row) =>
      isClosedPnlLiquidationRowUtil(row),
    );
    const isLiquidationByExecutions = await this.bybitPnl
      .detectLiquidationByExecutions({
        client,
        symbol: symNorm,
        direction: fresh.direction as 'long' | 'short',
        createdAt: fresh.createdAt,
        closedAt: new Date(),
        trackedOrderIds: ourIds,
      })
      .catch(() => false);
    const isLiquidation = isLiquidationByClosedPnl || isLiquidationByExecutions;
    const { totalPnl, hadParsedPnl } = this.bybitPnl.sumClosedPnlForSignal(
      rows,
      ourIds,
      fresh.direction,
      fresh.createdAt,
    );
    if (hadParsedPnl) {
      const nextStatus = totalPnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS';
      const liquidationData =
        isLiquidation && nextStatus === 'CLOSED_LOSS'
          ? { liquidation: true, liquidationLeverage }
          : { liquidation: false, liquidationLeverage: null };
      await this.orders.updateSignalStatus(fresh.id, {
        status: nextStatus,
        realizedPnl: totalPnl,
        closedAt: new Date(),
        ...liquidationData,
      });
      if (liquidationData.liquidation) {
        await this.bybitNotify.notifyApiTradeLiquidation({
          signalId: fresh.id,
          pair: symNorm,
          direction: fresh.direction,
          leverage: notifyLeverage,
          source: fresh.source ?? null,
          realizedPnl: totalPnl,
        });
      }
      return;
    }

    if (ourIds.size === 0) {
      return;
    }

    const sibling = await this.orders.findOlderClosedSiblingAfterNewerCreated(
      symNorm,
      fresh.direction,
      fresh.id,
      fresh.createdAt,
    );
    if (sibling) {
      await this.orders.updateSignalStatus(fresh.id, {
        status: 'CLOSED_MIXED',
        realizedPnl: null,
        closedAt: new Date(),
        liquidation: false,
        liquidationLeverage: null,
      });
      void this.appLog.append(
        'info',
        'bybit',
        'poll: дубликат сигнала без orderId в closed PnL — CLOSED_MIXED',
        { signalId: fresh.id, pair: symNorm, siblingId: sibling.id },
      );
      return;
    }

    if (hasOpenEntryOrders(fresh.orders as { orderKind: string; status: string | null }[])) {
      return;
    }
    const estimated = await this.bybitPnl.estimateClosedPnlFromExecutions({
      client,
      symbol: symNorm,
      direction: fresh.direction,
      createdAt: fresh.createdAt,
      closedAt: new Date(),
    });
    if (estimated !== undefined) {
      const nextStatus =
        estimated.netPnl > 0
          ? 'CLOSED_WIN'
          : estimated.netPnl < 0
            ? 'CLOSED_LOSS'
            : 'CLOSED_MIXED';
      const liquidationData =
        isLiquidation && nextStatus === 'CLOSED_LOSS'
          ? { liquidation: true, liquidationLeverage }
          : { liquidation: false, liquidationLeverage: null };
      await this.orders.updateSignalStatus(fresh.id, {
        status: nextStatus,
        realizedPnl: estimated.netPnl,
        closedAt: new Date(),
        ...liquidationData,
      });
      if (liquidationData.liquidation) {
        await this.bybitNotify.notifyApiTradeLiquidation({
          signalId: fresh.id,
          pair: symNorm,
          direction: fresh.direction,
          leverage: notifyLeverage,
          source: fresh.source ?? null,
          realizedPnl: estimated.netPnl,
        });
      }
      void this.appLog.append(
        'warn',
        'bybit',
        'poll: fallback PnL по execution list (closedPnL без orderId match)',
        {
          signalId: fresh.id,
          pair: symNorm,
          estimatedPnl: estimated.netPnl,
          trackedOrderIds: Array.from(ourIds),
        },
      );
      return;
    }

    await this.orders.updateSignalStatus(fresh.id, {
      status: 'CLOSED_MIXED',
      realizedPnl: null,
      closedAt: new Date(),
      liquidation: false,
      liquidationLeverage: null,
    });
    void this.appLog.append(
      'info',
      'bybit',
      'poll: позиция закрыта, но closed PnL не привязан к нашим orderId — CLOSED_MIXED',
      {
        signalId: fresh.id,
        pair: symNorm,
        trackedOrderIds: Array.from(ourIds),
      },
    );
  }
}
