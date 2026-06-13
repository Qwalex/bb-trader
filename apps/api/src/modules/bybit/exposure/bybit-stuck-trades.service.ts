import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { OrdersService } from '../../orders/orders.service';
import { WorkerQueueService } from '../../worker-queue/worker-queue.service';
import { BybitBalanceInstrumentService } from '../instrument/bybit-balance-instrument.service';
import { BybitRateLimitService } from '../instrument/bybit-rate-limit.service';
import {
  buildStuckSummary,
  classifyStuckLinearSignal,
  readPositionSizeAndSl,
} from './bybit-stuck-trades.util';
import type { StuckTradesSnapshotDto } from './bybit-stuck-trades.types';

/** Предупреждение в UI раньше, чем auto-recovery worker queue (10 мин). */
const POLL_STUCK_WARN_MS = 2 * 60 * 1000;

@Injectable()
export class BybitStuckTradesService {
  private readonly logger = new Logger(BybitStuckTradesService.name);

  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly balanceInstrument: BybitBalanceInstrumentService,
    private readonly rateLimit: BybitRateLimitService,
    private readonly cabinetContext: CabinetContextService,
    @Inject(forwardRef(() => WorkerQueueService))
    private readonly workers: WorkerQueueService,
  ) {}

  async getStuckTradesSnapshot(): Promise<StuckTradesSnapshotDto> {
    const scannedAt = new Date().toISOString();
    const client = await this.balanceInstrument.getClient();
    const bybitConnected = Boolean(client);
    const cabinetId = this.cabinetContext.getCabinetId()?.trim() ?? '';
    const pollState = cabinetId
      ? await this.workers.getPollJobStuckState(cabinetId, POLL_STUCK_WARN_MS)
      : { stuck: false, lockedSince: null };

    if (!client) {
      return {
        bybitConnected: false,
        scannedAt,
        pollStuck: pollState.stuck,
        pollLockedSince: pollState.lockedSince?.toISOString() ?? null,
        items: [],
      };
    }

    const openSignals = await this.orders.listOpenLinearSignals();
    const positionCache = new Map<
      string,
      { size: number; stopLoss?: string; takeProfit?: string } | 'error'
    >();

    const items: StuckTradesSnapshotDto['items'] = [];

    for (const sig of openSignals) {
      const symbol = normalizeTradingPair(sig.pair);
      const direction = sig.direction === 'short' ? 'short' : 'long';
      const cacheKey = `${symbol}:${direction}`;

      let pos = positionCache.get(cacheKey);
      if (pos === undefined) {
        try {
          const res = await this.rateLimit.runBybitCall(() =>
            client.getPositionInfo({ category: 'linear', symbol }),
          );
          if (res.retCode !== 0) {
            pos = 'error';
          } else {
            pos = readPositionSizeAndSl(res.result?.list ?? [], direction);
          }
        } catch (e) {
          this.logger.debug(`stuck scan ${symbol}: ${formatError(e)}`);
          pos = 'error';
        }
        positionCache.set(cacheKey, pos);
      }

      const positionSize = pos === 'error' ? 0 : pos.size;
      const positionStopLoss = pos === 'error' ? undefined : pos.stopLoss;
      const positionTakeProfit = pos === 'error' ? undefined : pos.takeProfit;

      const issues = classifyStuckLinearSignal({
        takeProfits: sig.takeProfits,
        stopLoss: sig.stopLoss,
        direction: sig.direction,
        orders: sig.orders,
        positionSize,
        positionStopLoss,
        positionTakeProfit,
      });

      if (issues.length === 0) {
        continue;
      }

      items.push({
        signalId: sig.id,
        pair: symbol,
        direction: sig.direction,
        status: sig.status,
        source: sig.source ?? null,
        createdAt: sig.createdAt.toISOString(),
        positionSize,
        issues,
        summary: buildStuckSummary(issues),
      });
    }

    return {
      bybitConnected,
      scannedAt,
      pollStuck: pollState.stuck,
      pollLockedSince: pollState.lockedSince?.toISOString() ?? null,
      items,
    };
  }
}
