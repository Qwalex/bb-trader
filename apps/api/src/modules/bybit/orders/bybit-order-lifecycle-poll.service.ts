import { Injectable, Logger } from '@nestjs/common';
import type { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { BYBIT_STALE_RECONCILE_REQUIRED_CLEAN_POLLS } from '../bybit.constants';
import type { BybitOrderLifecyclePollPorts } from '../types/bybit-ports.types';
import {
  applyTpSlForSignal,
  finalizeSignalIfNeeded,
  shouldApplyTpSlWithoutOrderSync,
  shouldSkipExchangeOrderSync,
  syncSignalOrderStatusesFromExchange,
  type PollSignalRow,
} from './bybit-order-lifecycle-poll-signal.util';
import { hasLiveTpOrders, hasOpenEntryOrders } from './bybit-order-status.util';

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
      await this.processOpenSignal(ports, client, sig as PollSignalRow);
    }
  }

  private async processOpenSignal(
    ports: BybitOrderLifecyclePollPorts,
    client: RestClientV5,
    sig: PollSignalRow,
  ): Promise<void> {
    const skipSync = shouldSkipExchangeOrderSync(sig);
    const applyWithoutSync = shouldApplyTpSlWithoutOrderSync(sig);

    if (!skipSync && !applyWithoutSync) {
      await syncSignalOrderStatusesFromExchange(ports, client, sig, (msg) =>
        this.logger.debug(`poll ${msg}`),
      );
    }

    const fresh = (await ports.orders.getSignalWithOrders(sig.id)) as PollSignalRow | null;
    if (!fresh) {
      return;
    }

    const hadOpenEntries = hasOpenEntryOrders(sig.orders);
    const hasOpenEntriesNow = hasOpenEntryOrders(fresh.orders);

    if (
      ports.scheduleFastTpSlApply &&
      hadOpenEntries &&
      !hasOpenEntriesNow &&
      !hasLiveTpOrders(fresh.orders)
    ) {
      ports.scheduleFastTpSlApply(fresh.id, 'poll-fill-detected');
    }

    if (skipSync) {
      try {
        await ports.stepStopLossIfTpFilled(client, fresh);
      } catch (e) {
        this.logger.warn(`stepStopLossIfTpFilled: ${formatError(e)}`);
      }
      await finalizeSignalIfNeeded(ports, client, fresh, (msg) =>
        this.logger.debug(`poll ${msg}`),
      );
      return;
    }

    await applyTpSlForSignal(ports, client, fresh, (label, err) =>
      this.logger.warn(`${label}: ${formatError(err)}`),
    );

    await finalizeSignalIfNeeded(ports, client, fresh, (msg) =>
      this.logger.debug(`poll ${msg}`),
    );
  }
}
