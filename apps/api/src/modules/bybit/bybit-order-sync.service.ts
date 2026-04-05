import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../common/format-error';
import { AppLogService } from '../app-log/app-log.service';
import { OrdersService } from '../orders/orders.service';

import { BybitClientService } from './bybit-client.service';
import { BybitExposureService } from './bybit-exposure.service';
import { BybitPlacementService } from './bybit-placement.service';
import { BybitPnlService } from './bybit-pnl.service';
import {
  hasOpenEntryOrders,
  isFilledOrderStatus,
  pickLiveExposurePositionForDirection,
} from './bybit-order-helpers';

/**
 * Синхронизация открытых ордеров/позиций с Bybit (poll): без циклического импорта Exposure ↔ Placement.
 */
@Injectable()
export class BybitOrderSyncService {
  private readonly logger = new Logger(BybitOrderSyncService.name);

  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    private readonly bybitClient: BybitClientService,
    private readonly exposure: BybitExposureService,
    private readonly placement: BybitPlacementService,
    private readonly pnl: BybitPnlService,
  ) {}

  async pollOpenOrders(): Promise<void> {
    const client = await this.bybitClient.getClient();
    if (!client) {
      return;
    }

    await this.exposure.runStaleOrdersPlacedReconciliation(client);

    const openSignals = await this.orders.listOpenSignals();
    for (const sig of openSignals) {
      for (const ord of sig.orders) {
        if (!ord.bybitOrderId) continue;
        try {
          const st = await this.exposure.fetchOrderStatusFromExchange(
            client,
            sig.pair,
            ord.bybitOrderId,
            ord.qty != null ? Number(ord.qty) : undefined,
          );
          if (st) {
            await this.orders.updateOrder(ord.id, {
              status: st,
              filledAt: isFilledOrderStatus(st) ? new Date() : undefined,
            });
          }
        } catch (err) {
          this.logger.debug(`poll order ${ord.bybitOrderId}: ${String(err)}`);
        }
      }

      const fresh = await this.orders.getSignalWithOrders(sig.id);
      if (!fresh) continue;

      try {
        await this.placement.ensureStopLossForMultiTpOpenPosition(client, fresh);
      } catch (e) {
        this.logger.warn(
          `ensureStopLossForMultiTpOpenPosition: ${formatError(e)}`,
        );
      }

      try {
        await this.placement.placeTpSplitIfNeeded(client, fresh);
      } catch (e) {
        this.logger.warn(`placeTpSplitIfNeeded: ${formatError(e)}`);
      }

      try {
        const symNorm = normalizeTradingPair(fresh.pair);
        const livePositions = await this.exposure.getExchangePositions(
          client,
          symNorm,
        );
        const mainPosition = pickLiveExposurePositionForDirection(
          livePositions,
          fresh.direction as 'long' | 'short',
        );
        const posSize = mainPosition ? Math.abs(mainPosition.size) : 0;
        const hadFill = fresh.orders.some((o) => isFilledOrderStatus(o.status));
        if (hadFill && posSize === 0 && fresh.status === 'ORDERS_PLACED') {
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
              .filter((id): id is string => id.length > 0),
          );
          const requestWindow = this.pnl.buildClosedPnlWindow(
            fresh.createdAt,
            new Date(),
          );
          const rows = await this.pnl.fetchClosedPnlRowsForSymbol(
            client,
            symNorm,
            requestWindow.startTime,
            requestWindow.endTime,
          );
          const { totalPnl, hadParsedPnl } = this.pnl.sumClosedPnlForSignal(
            rows,
            ourIds,
            fresh.direction,
            fresh.createdAt,
          );
          if (hadParsedPnl) {
            await this.orders.updateSignalStatus(fresh.id, {
              status: totalPnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS',
              realizedPnl: totalPnl,
              closedAt: new Date(),
            });
          } else if (ourIds.size > 0) {
            const sibling =
              await this.orders.findOlderClosedSiblingAfterNewerCreated(
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
              });
              void this.appLog.append(
                'info',
                'bybit',
                'poll: дубликат сигнала без orderId в closed PnL — CLOSED_MIXED',
                {
                  signalId: fresh.id,
                  pair: symNorm,
                  siblingId: sibling.id,
                },
              );
            } else if (!hasOpenEntryOrders(fresh.orders)) {
              const estimated = await this.pnl.estimateClosedPnlFromExecutions({
                client,
                symbol: symNorm,
                direction: fresh.direction,
                createdAt: fresh.createdAt,
                closedAt: new Date(),
              });
              if (estimated !== undefined) {
                await this.orders.updateSignalStatus(fresh.id, {
                  status:
                    estimated.netPnl > 0
                      ? 'CLOSED_WIN'
                      : estimated.netPnl < 0
                        ? 'CLOSED_LOSS'
                        : 'CLOSED_MIXED',
                  realizedPnl: estimated.netPnl,
                  closedAt: new Date(),
                });
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
              } else {
                await this.orders.updateSignalStatus(fresh.id, {
                  status: 'CLOSED_MIXED',
                  realizedPnl: null,
                  closedAt: new Date(),
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
          }
        }
      } catch (err) {
        this.logger.debug(`poll position ${fresh.pair}: ${String(err)}`);
      }
    }
  }
}
