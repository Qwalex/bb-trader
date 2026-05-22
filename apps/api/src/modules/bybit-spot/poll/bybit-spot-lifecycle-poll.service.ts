import { Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { isFilledOrderStatus } from '../../bybit/orders/bybit-order-status.util';
import { BybitSpotInstrumentService } from '../instrument/bybit-spot-instrument.service';
import { BybitSpotOrderQueryService } from '../orders/bybit-spot-order-query.service';
import type { BybitSpotLifecyclePollPorts } from '../types/bybit-spot.types';
import { computeSpotRealizedPnlFromOrders } from '../utils/bybit-spot-pnl.util';
import { BybitSpotPriceWatchService } from '../watch/bybit-spot-price-watch.service';

@Injectable()
export class BybitSpotLifecyclePollService {
  private readonly logger = new Logger(BybitSpotLifecyclePollService.name);
  private readonly staleFlatPollCounts = new Map<string, number>();
  private static readonly STALE_CLEAN_POLLS = 3;

  constructor(
    private readonly orderQuery: BybitSpotOrderQueryService,
    private readonly instrument: BybitSpotInstrumentService,
    private readonly priceWatch: BybitSpotPriceWatchService,
  ) {}

  async pollSpotSignals(ports: BybitSpotLifecyclePollPorts): Promise<void> {
    const client = await ports.getClient();
    if (!client) {
      return;
    }

    let openSignals = await ports.orders.listOpenSpotSignals();
    await this.reconcileStaleSpotOrders(client, openSignals, ports);

    openSignals = await ports.orders.listOpenSpotSignals();
    for (const sig of openSignals) {
      for (const ord of sig.orders) {
        if (!ord.bybitOrderId) {
          continue;
        }
        try {
          const snap = await this.orderQuery.fetchSpotOrderSnapshot(
            client,
            sig.pair,
            ord.bybitOrderId,
          );
          if (!snap) {
            continue;
          }
          const dbStatus = this.orderQuery.mapSpotStatusForDb(snap.status);
          const update: {
            status: string;
            filledAt?: Date;
            price?: number;
            qty?: number;
          } = { status: dbStatus };
          if (isFilledOrderStatus(snap.status)) {
            update.filledAt = new Date();
          }
          if (snap.avgPrice != null) {
            update.price = snap.avgPrice;
          }
          if (snap.cumExecQty > 0) {
            update.qty = snap.cumExecQty;
          }
          await ports.orders.updateOrder(ord.id, update);
        } catch (err) {
          this.logger.debug(`spot poll order ${ord.bybitOrderId}: ${String(err)}`);
        }
      }

      const fresh = await ports.orders.getSignalWithOrders(sig.id);
      if (!fresh || fresh.marketType !== 'spot') {
        continue;
      }

      await this.promoteToOpenIfBuyFilled(fresh, ports);
      await this.syncSpotBaseQtyFromOrders(fresh, ports);

      const refreshed = await ports.orders.getSignalWithOrders(sig.id);
      if (!refreshed) {
        continue;
      }

      if (refreshed.status === 'OPEN' && (refreshed.spotBaseQty ?? 0) > 0) {
        const notifiedUpdates = await this.priceWatch.checkOpenSpotSignals(client, [refreshed]);
        const nextJson = notifiedUpdates.get(refreshed.id);
        if (nextJson != null) {
          await ports.orders.updateSignalStatus(refreshed.id, { spotNotifiedJson: nextJson });
        }
      }

      await this.finalizeSpotCloseIfNeeded(refreshed, ports);
    }
  }

  private async reconcileStaleSpotOrders(
    client: RestClientV5,
    openSignals: Array<{ id: string; pair: string; status: string }>,
    ports: BybitSpotLifecyclePollPorts,
  ): Promise<void> {
    const staleCandidates = openSignals.filter((s) => s.status === 'ORDERS_PLACED');
    for (const sig of staleCandidates) {
      const symbol = normalizeTradingPair(sig.pair);
      const key = `${symbol}:${sig.id}`;
      try {
        const hasOpen = await this.orderQuery.hasOpenSpotOrders(client, symbol);
        if (hasOpen) {
          this.staleFlatPollCounts.delete(key);
          continue;
        }
        const fresh = await ports.orders.getSignalWithOrders(sig.id);
        const hasFill = (fresh?.orders ?? []).some(
          (o) => o.orderKind === 'ENTRY' && isFilledOrderStatus(o.status ?? ''),
        );
        if (hasFill) {
          this.staleFlatPollCounts.delete(key);
          continue;
        }
        const cleanCount = (this.staleFlatPollCounts.get(key) ?? 0) + 1;
        this.staleFlatPollCounts.set(key, cleanCount);
        if (cleanCount < BybitSpotLifecyclePollService.STALE_CLEAN_POLLS) {
          continue;
        }
        this.staleFlatPollCounts.delete(key);
        await ports.orders.updateSignalStatus(sig.id, {
          status: 'CLOSED_LOSS',
          closedAt: new Date(),
        });
        void ports.appLog.append('info', 'bybit', 'spot stale ORDERS_PLACED reconciled', {
          signalId: sig.id,
          symbol,
        });
      } catch (e) {
        this.staleFlatPollCounts.delete(key);
        this.logger.warn(`spot stale reconcile ${sig.id}: ${formatError(e)}`);
      }
    }
  }

  private async promoteToOpenIfBuyFilled(
    fresh: {
      id: string;
      pair: string;
      status: string;
      orders: Array<{ orderKind: string; side: string; status: string | null; qty: number | null }>;
    },
    ports: BybitSpotLifecyclePollPorts,
  ): Promise<void> {
    if (fresh.status !== 'ORDERS_PLACED') {
      return;
    }
    const entry = fresh.orders.find((o) => o.orderKind === 'ENTRY');
    if (!entry || !isFilledOrderStatus(entry.status ?? '')) {
      return;
    }
    const baseQty = entry.qty ?? 0;
    if (!(baseQty > 0)) {
      return;
    }
    await ports.orders.updateSignalStatus(fresh.id, {
      status: 'OPEN',
      spotBaseQty: baseQty,
    });
    void ports.appLog.append('info', 'bybit', 'spot buy filled → OPEN', {
      signalId: fresh.id,
      pair: fresh.pair,
      spotBaseQty: baseQty,
    });
  }

  private async syncSpotBaseQtyFromOrders(
    fresh: {
      id: string;
      status: string;
      spotBaseQty: number | null;
      orders: Array<{
        orderKind: string;
        side: string;
        status: string | null;
        qty: number | null;
      }>;
    },
    ports: BybitSpotLifecyclePollPorts,
  ): Promise<void> {
    if (fresh.status !== 'OPEN') {
      return;
    }
    let bought = 0;
    let sold = 0;
    for (const o of fresh.orders) {
      if (!isFilledOrderStatus(o.status ?? '')) {
        continue;
      }
      const qty = o.qty ?? 0;
      if (!(qty > 0)) {
        continue;
      }
      const side = (o.side ?? '').toLowerCase();
      if (side === 'buy') {
        bought += qty;
      } else if (side === 'sell') {
        sold += qty;
      }
    }
    const remaining = Math.max(0, bought - sold);
    if (Math.abs(remaining - (fresh.spotBaseQty ?? 0)) > 1e-8) {
      await ports.orders.updateSignalStatus(fresh.id, { spotBaseQty: remaining });
    }
  }

  private async finalizeSpotCloseIfNeeded(
    fresh: {
      id: string;
      pair: string;
      status: string;
      spotBaseQty: number | null;
      orders: Array<{
        orderKind: string;
        side: string;
        price: number | null;
        qty: number | null;
        status: string | null;
      }>;
    },
    ports: BybitSpotLifecyclePollPorts,
  ): Promise<void> {
    if (fresh.status !== 'OPEN') {
      return;
    }
    const remaining = fresh.spotBaseQty ?? 0;
    if (remaining > 0) {
      return;
    }
    const pnl = computeSpotRealizedPnlFromOrders(fresh.orders);
    const closeStatus = pnl != null && pnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS';
    await ports.orders.updateSignalStatus(fresh.id, {
      status: closeStatus,
      closedAt: new Date(),
      realizedPnl: pnl ?? undefined,
    });
    void ports.appLog.append('info', 'bybit', 'spot position closed', {
      signalId: fresh.id,
      pair: fresh.pair,
      pnl,
      closeStatus,
    });
  }
}
