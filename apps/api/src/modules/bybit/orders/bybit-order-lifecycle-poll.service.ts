import { Injectable, Logger } from '@nestjs/common';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { BYBIT_STALE_RECONCILE_REQUIRED_CLEAN_POLLS } from '../bybit.constants';
import type { BybitOrderLifecyclePollPorts } from '../types/bybit-ports.types';

@Injectable()
export class BybitOrderLifecyclePollService {
  private readonly logger = new Logger(BybitOrderLifecyclePollService.name);

  async pollOpenOrders(ports: BybitOrderLifecyclePollPorts): Promise<void> {
    const client = await ports.getClient();
    if (!client) {
      return;
    }

    let openSignals = await ports.orders.listOpenSignals();
    const staleCandidates = openSignals.filter((sig: any) => sig.status === 'ORDERS_PLACED');
    const uniquePairDirections = new Map<string, { pair: string; direction: 'long' | 'short' }>();
    for (const sig of staleCandidates) {
      const symbol = normalizeTradingPair(sig.pair);
      const key = ports.stalePairDirectionKey(symbol, sig.direction as 'long' | 'short');
      if (!uniquePairDirections.has(key)) {
        uniquePairDirections.set(key, { pair: symbol, direction: sig.direction as 'long' | 'short' });
      }
    }

    for (const existingKey of Array.from(ports.staleFlatPollCounts.keys()) as string[]) {
      if (!uniquePairDirections.has(existingKey)) {
        ports.staleFlatPollCounts.delete(existingKey);
      }
    }

    if (uniquePairDirections.size > 0) {
      void ports.appLog.append('debug', 'bybit', 'poll: reconcile stale pass started', {
        staleSignals: staleCandidates.length,
        uniquePairDirections: uniquePairDirections.size,
      });
    }

    for (const { pair, direction } of uniquePairDirections.values()) {
      const reconcileKey = ports.stalePairDirectionKey(pair, direction);
      if (ports.staleReconcileSuspensions.has(reconcileKey)) {
        ports.staleFlatPollCounts.delete(reconcileKey);
        const suspension = ports.staleReconcileSuspensions.get(reconcileKey);
        void ports.appLog.append(
          'debug',
          'bybit',
          'poll: stale reconcile skipped because pair is suspended',
          {
            symbol: pair,
            direction,
            reason: suspension?.reason ?? null,
            lockCount: suspension?.count ?? 0,
          },
        );
        continue;
      }
      try {
        const busy = await ports.hasExchangeExposureForDirection(client, pair, direction);
        if (busy) {
          ports.staleFlatPollCounts.delete(reconcileKey);
          void ports.appLog.append(
            'debug',
            'bybit',
            'poll: stale signal kept because exchange exposure still exists',
            { symbol: pair, direction },
          );
          continue;
        }

        const cleanCount = (ports.staleFlatPollCounts.get(reconcileKey) ?? 0) + 1;
        ports.staleFlatPollCounts.set(reconcileKey, cleanCount);
        if (cleanCount < BYBIT_STALE_RECONCILE_REQUIRED_CLEAN_POLLS) {
          void ports.appLog.append(
            'debug',
            'bybit',
            'poll: stale reconcile postponed until clean state repeats',
            {
              symbol: pair,
              direction,
              cleanPollsObserved: cleanCount,
              cleanPollsRequired: BYBIT_STALE_RECONCILE_REQUIRED_CLEAN_POLLS,
            },
          );
          continue;
        }

        const reconciledIds = await ports.orders.reconcileStaleOpenSignalsForPairAndDirection(
          pair,
          direction,
        );
        ports.staleFlatPollCounts.delete(reconcileKey);
        if (reconciledIds.length > 0) {
          void ports.appLog.append(
            'info',
            'bybit',
            'poll: автоматически сняты зависшие ORDERS_PLACED при чистой бирже',
            { symbol: pair, direction, signalsUpdated: reconciledIds.length },
          );
          void ports.notifyStaleReconcileTradeCancelled(
            reconciledIds,
            'Синхронизация с Bybit: на бирже нет ордеров/позиции, сделка закрыта в учёте',
          );
        } else {
          void ports.appLog.append(
            'debug',
            'bybit',
            'poll: no stale signals found to reconcile for clean exchange side',
            { symbol: pair, direction },
          );
        }
      } catch (err) {
        ports.staleFlatPollCounts.delete(reconcileKey);
        void ports.appLog.append('warn', 'bybit', 'poll: failed to reconcile stale ORDERS_PLACED', {
          symbol: pair,
          direction,
          error: formatError(err),
        });
        this.logger.warn(`poll reconcile stale ${pair} ${direction}: ${formatError(err)}`);
      }
    }

    openSignals = await ports.orders.listOpenSignals();
    for (const sig of openSignals) {
      for (const ord of sig.orders) {
        if (!ord.bybitOrderId) continue;
        try {
          const st = await ports.fetchOrderStatusFromExchange(
            client,
            sig.pair,
            ord.bybitOrderId,
            ord.qty != null ? Number(ord.qty) : undefined,
          );
          if (st) {
            await ports.orders.updateOrder(ord.id, {
              status: st,
              filledAt: ports.isFilledOrderStatus(st) ? new Date() : undefined,
            });
          }
        } catch (err) {
          this.logger.debug(`poll order ${ord.bybitOrderId}: ${String(err)}`);
        }
      }

      const fresh = await ports.orders.getSignalWithOrders(sig.id);
      if (!fresh) continue;

      try {
        await ports.ensureStopLossForMultiTpOpenPosition(client, fresh);
      } catch (e) {
        this.logger.warn(`ensureStopLossForMultiTpOpenPosition: ${formatError(e)}`);
      }

      try {
        await ports.placeTpSplitIfNeeded(client, fresh);
      } catch (e) {
        this.logger.warn(`placeTpSplitIfNeeded: ${formatError(e)}`);
      }

      try {
        await ports.stepStopLossIfTpFilled(client, fresh);
      } catch (e) {
        this.logger.warn(`stepStopLossIfTpFilled: ${formatError(e)}`);
      }

      try {
        await ports.finalizeSignalCloseIfNeeded(client, fresh);
      } catch (err) {
        this.logger.debug(`poll position ${fresh.pair}: ${String(err)}`);
      }
    }
  }
}
