import { Injectable } from '@nestjs/common';

import type { SignalDto } from '@repo/shared';

import { BybitExposureService } from './bybit-exposure.service';
import { BybitMarketService } from './bybit-market.service';
import { BybitOrderSyncService } from './bybit-order-sync.service';
import { BybitPlacementService } from './bybit-placement.service';
import { BybitPnlService } from './bybit-pnl.service';
import type {
  PlaceOrdersResult,
  RecalcClosedPnlJobStatus,
  RecalcClosedPnlResult,
  TradePnlBreakdownResult,
} from './bybit.types';

/** Публичные типы Bybit (обратная совместимость импортов из `bybit.service`). */
export * from './bybit.types';

/**
 * Фасад над доменными сервисами Bybit; сохраняет прежний контракт для контроллеров и модулей.
 */
@Injectable()
export class BybitService {
  constructor(
    private readonly market: BybitMarketService,
    private readonly exposure: BybitExposureService,
    private readonly placement: BybitPlacementService,
    private readonly pnl: BybitPnlService,
    private readonly orderSync: BybitOrderSyncService,
  ) {}

  getUnifiedUsdtBalance(workspaceId?: string | null) {
    return this.market.getUnifiedUsdtBalance(workspaceId);
  }

  getUnifiedUsdtBalanceDetails(workspaceId?: string | null) {
    return this.market.getUnifiedUsdtBalanceDetails(workspaceId);
  }

  getLastPriceForPair(pair: string) {
    return this.market.getLastPriceForPair(pair);
  }

  wouldDuplicateActivePairDirection(
    pair: string,
    direction: 'long' | 'short',
    workspaceId?: string | null,
  ) {
    return this.exposure.wouldDuplicateActivePairDirection(pair, direction, workspaceId);
  }

  getLiveExposureSnapshot(workspaceId?: string | null) {
    return this.exposure.getLiveExposureSnapshot(workspaceId);
  }

  getSignalExecutionDebugSnapshot(signalId: string, workspaceId?: string | null) {
    return this.exposure.getSignalExecutionDebugSnapshot(signalId, workspaceId);
  }

  cleanupExchangeBeforeDeletingPlacedSignal(
    signalId: string,
    workspaceId?: string | null,
  ) {
    return this.exposure.cleanupExchangeBeforeDeletingPlacedSignal(
      signalId,
      workspaceId,
    );
  }

  closeSignalManually(signalId: string, workspaceId?: string | null) {
    return this.exposure.closeSignalManually(signalId, workspaceId);
  }

  suspendStaleReconcile(
    pair: string,
    direction: 'long' | 'short',
    reason?: string,
  ) {
    return this.exposure.suspendStaleReconcile(pair, direction, reason);
  }

  resumeStaleReconcile(pair: string, direction: 'long' | 'short') {
    return this.exposure.resumeStaleReconcile(pair, direction);
  }

  placeSignalOrders(
    signal: SignalDto,
    rawMessage: string | undefined,
    origin?: { chatId?: string; messageId?: string; workspaceId?: string | null },
  ): Promise<PlaceOrdersResult> {
    return this.placement.placeSignalOrders(signal, rawMessage, origin);
  }

  getTradePnlBreakdown(
    signalId: string,
    workspaceId?: string | null,
  ): Promise<TradePnlBreakdownResult> {
    return this.pnl.getTradePnlBreakdown(signalId, workspaceId);
  }

  startRecalcClosedSignalsPnlJob(params?: {
    limit?: number;
    dryRun?: boolean;
    workspaceId?: string | null;
  }): RecalcClosedPnlJobStatus {
    return this.pnl.startRecalcClosedSignalsPnlJob(params);
  }

  getRecalcClosedPnlJobStatus(jobId: string, workspaceId?: string | null) {
    return this.pnl.getRecalcClosedPnlJobStatus(jobId, workspaceId);
  }

  recalcClosedSignalsPnl(params?: {
    limit?: number;
    dryRun?: boolean;
    workspaceId?: string | null;
  }): Promise<RecalcClosedPnlResult> {
    return this.pnl.recalcClosedSignalsPnl(params);
  }

  pollOpenOrders(): Promise<void> {
    return this.orderSync.pollOpenOrders();
  }
}
