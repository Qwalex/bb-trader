import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import type { SignalDto } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import type { ActiveSignalTradeSnapshot } from '../../orders/orders-active-signal-snapshot.types';
import { OrdersService } from '../../orders/orders.service';
import { TelegramService } from '../../telegram';
import { VkNotifyMirrorService } from '../../vk/vk-notify-mirror.service';
import { WorkerQueueService } from '../../worker-queue/worker-queue.service';
import { parseNumberArrayFromJson } from '../instrument/bybit-json.util';

@Injectable()
export class BybitNotifyService {
  private readonly logger = new Logger(BybitNotifyService.name);

  constructor(
    private readonly cabinetContext: CabinetContextService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegram: TelegramService,
    @Inject(forwardRef(() => VkNotifyMirrorService))
    private readonly vkNotifyMirror: VkNotifyMirrorService,
    @Inject(forwardRef(() => WorkerQueueService))
    private readonly workers: WorkerQueueService,
  ) {}

  private currentCabinetId(): string | null {
    return this.cabinetContext.getCabinetId();
  }

  async notifyApiTradeCancelled(
    signal: {
      id: string;
      pair: string;
      direction: string;
      entries: string;
      entryIsRange?: boolean;
      stopLoss: number;
      takeProfits: string;
      leverage: number;
      orderUsd: number;
      capitalPercent: number;
      source: string | null;
    },
    reason: string,
  ): Promise<void> {
    try {
      const res = await this.telegram.notifyApiTradeCancelled({
        signalId: signal.id,
        pair: signal.pair,
        direction: signal.direction,
        entries: parseNumberArrayFromJson(signal.entries),
        entryIsRange: signal.entryIsRange,
        stopLoss: signal.stopLoss,
        takeProfits: parseNumberArrayFromJson(signal.takeProfits),
        leverage: signal.leverage,
        orderUsd: signal.orderUsd,
        capitalPercent: signal.capitalPercent,
        source: signal.source,
        reason,
      });
      if (!res.ok) {
        this.logger.warn(
          `notifyApiTradeCancelled failed signalId=${signal.id}: ${res.error ?? 'unknown'}`,
        );
      }

      void this.vkNotifyMirror.mirrorNotifyApiTradeCancelled({
        signalId: signal.id,
        pair: signal.pair,
        direction: signal.direction,
        entries: parseNumberArrayFromJson(signal.entries),
        entryIsRange: signal.entryIsRange,
        stopLoss: signal.stopLoss,
        takeProfits: parseNumberArrayFromJson(signal.takeProfits),
        leverage: signal.leverage,
        orderUsd: signal.orderUsd,
        capitalPercent: signal.capitalPercent,
        source: signal.source,
        reason,
      });
    } catch (e) {
      this.logger.warn(
        `notifyApiTradeCancelled exception signalId=${signal.id}: ${formatError(e)}`,
      );
    }
  }

  async notifyHedgeOppositePlacementAudit(params: {
    symbol: string;
    hedgeModeActive: boolean;
    oppositeOnExchange: boolean;
    oppositeSideDb: ActiveSignalTradeSnapshot | null;
    newSignalId: string;
    newSignalDto: SignalDto;
  }): Promise<void> {
    try {
      const existingOppositeDb = params.oppositeSideDb
        ? {
            id: params.oppositeSideDb.id,
            pair: params.oppositeSideDb.pair,
            direction: params.oppositeSideDb.direction,
            status: params.oppositeSideDb.status,
            entries: parseNumberArrayFromJson(params.oppositeSideDb.entries),
            entryIsRange: params.oppositeSideDb.entryIsRange,
            stopLoss: params.oppositeSideDb.stopLoss,
            takeProfits: parseNumberArrayFromJson(params.oppositeSideDb.takeProfits),
            leverage: params.oppositeSideDb.leverage,
            orderUsd: params.oppositeSideDb.orderUsd,
            capitalPercent: params.oppositeSideDb.capitalPercent,
            source: params.oppositeSideDb.source,
          }
        : null;
      const res = await this.telegram.notifyHedgeOppositePlacementAudit({
        symbol: params.symbol,
        hedgeModeActive: params.hedgeModeActive,
        oppositeOnExchange: params.oppositeOnExchange,
        existingOppositeDb,
        newPlaced: {
          signalId: params.newSignalId,
          pair: params.newSignalDto.pair,
          direction: params.newSignalDto.direction,
          entries: params.newSignalDto.entries,
          entryIsRange: params.newSignalDto.entryIsRange,
          stopLoss: params.newSignalDto.stopLoss,
          takeProfits: params.newSignalDto.takeProfits,
          leverage: params.newSignalDto.leverage,
          orderUsd: params.newSignalDto.orderUsd,
          capitalPercent: params.newSignalDto.capitalPercent,
          source: params.newSignalDto.source,
        },
      });
      if (!res.ok) {
        this.logger.warn(
          `notifyHedgeOppositePlacementAudit failed newSignalId=${params.newSignalId}: ${res.error ?? 'unknown'}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `notifyHedgeOppositePlacementAudit exception newSignalId=${params.newSignalId}: ${formatError(e)}`,
      );
    }
  }

  async notifyApiTradeLiquidation(params: {
    signalId: string;
    pair: string;
    direction: string;
    leverage: number;
    source: string | null;
    realizedPnl?: number | null;
  }): Promise<void> {
    try {
      const res = await this.telegram.notifyApiTradeLiquidation({
        signalId: params.signalId,
        pair: params.pair,
        direction: params.direction,
        leverage: params.leverage,
        source: params.source,
        realizedPnl: params.realizedPnl,
      });
      if (!res.ok) {
        this.logger.warn(
          `notifyApiTradeLiquidation failed signalId=${params.signalId}: ${res.error ?? 'unknown'}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `notifyApiTradeLiquidation exception signalId=${params.signalId}: ${formatError(e)}`,
      );
    }
  }

  async processTradeCancelledNotificationJob(params: {
    signalIds: string[];
    reason: string;
  }): Promise<void> {
    const { signalIds, reason } = params;
    for (const signalId of signalIds) {
      try {
        const signal = await this.orders.getSignalWithOrders(signalId);
        if (!signal) {
          continue;
        }
        await this.notifyApiTradeCancelled(signal, reason);
      } catch (e) {
        this.logger.warn(
          `notifyStaleReconcileTradeCancelled signalId=${signalId}: ${formatError(e)}`,
        );
      }
    }
  }

  async notifyStaleReconcileTradeCancelled(
    signalIds: string[],
    reason: string,
  ): Promise<void> {
    await this.workers.enqueueTradeCancelledNotification({
      cabinetId: this.currentCabinetId(),
      signalIds,
      reason,
    });
  }
}
