import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { OrdersService } from '../orders/orders.service';
import { SettingsService } from '../settings/settings.service';
import { WorkerQueueService } from '../worker-queue/worker-queue.service';
import { stalePairDirectionKey as stalePairDirectionKeyUtil } from './bybit-exposure.util';
import { BybitBalanceInstrumentService } from './bybit-balance-instrument.service';
import { BybitClientService } from './bybit-client.service';
import { BybitExchangeCleanupService } from './bybit-exchange-cleanup.service';
import { BybitExposureService } from './bybit-exposure.service';
import { BybitLiveSnapshotService } from './bybit-live-snapshot.service';
import { BybitNotifyService } from './bybit-notify.service';
import { BybitOrderExchangeQueryService } from './bybit-order-exchange-query.service';
import { BybitOrderLifecyclePollService } from './bybit-order-lifecycle-poll.service';
import {
  isFilledOrderStatus,
  isInsufficientBalanceError,
} from './bybit-order-status.util';
import { BybitPlacementValidationService } from './bybit-placement-validation.service';
import { pickPositionRowForSignalDirection } from './bybit-position-pick.util';
import { BybitPollFinalizeService } from './bybit-poll-finalize.service';
import { BybitPnlService } from './bybit-pnl.service';
import { BybitPositionCloseService } from './bybit-position-close.service';
import { BybitRecalcService } from './bybit-recalc.service';
import { BybitSignalOverridesService } from './bybit-signal-overrides.service';
import { BybitSignalPlacementService } from './bybit-signal-placement.service';
import { BybitTpSlService } from './bybit-tpsl.service';
import type {
  CloseSignalResult,
  PlaceOrdersResult,
  RecalcClosedPnlJobStatus,
  RecalcClosedPnlResult,
  SignalExecutionDebugSnapshot,
  TradePnlBreakdownResult,
} from './bybit.types';

@Injectable()
export class BybitService implements OnModuleInit {
  private readonly logger = new Logger(BybitService.name);
  private readonly staleFlatPollCounts = new Map<string, number>();
  private readonly staleReconcileSuspensions = new Map<string, { count: number; reason?: string }>();
  private readonly placementLocks = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cabinetContext: CabinetContextService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    @Inject(forwardRef(() => WorkerQueueService))
    private readonly workers: WorkerQueueService,
    private readonly bybitClient: BybitClientService,
    private readonly bybitExposure: BybitExposureService,
    private readonly bybitTpSl: BybitTpSlService,
    private readonly bybitPnl: BybitPnlService,
    private readonly bybitSignalPlacement: BybitSignalPlacementService,
    private readonly bybitOrderLifecyclePoll: BybitOrderLifecyclePollService,
    private readonly bybitNotify: BybitNotifyService,
    private readonly bybitPositionClose: BybitPositionCloseService,
    private readonly bybitRecalc: BybitRecalcService,
    private readonly balanceInstrument: BybitBalanceInstrumentService,
    private readonly orderExchangeQuery: BybitOrderExchangeQueryService,
    private readonly placementValidation: BybitPlacementValidationService,
    private readonly signalOverrides: BybitSignalOverridesService,
    private readonly liveSnapshot: BybitLiveSnapshotService,
    private readonly pollFinalize: BybitPollFinalizeService,
    private readonly exchangeCleanup: BybitExchangeCleanupService,
  ) {}

  onModuleInit(): void {
    void this.bybitClient.startPrivateWsSync({
      onWsUpdate: () => this.workers.enqueuePollSweep('bybit-ws-update'),
    });
  }

  private currentCabinetId(): string | null {
    return this.cabinetContext.getCabinetId();
  }

  async getUnifiedUsdtBalance(): Promise<number | undefined> {
    return this.balanceInstrument.getUnifiedUsdtBalance();
  }

  async getUnifiedUsdtBalanceDetails(): Promise<
    { availableUsd: number; totalUsd: number } | undefined
  > {
    return this.balanceInstrument.getUnifiedUsdtBalanceDetails();
  }

  async getLastPriceForPair(pair: string): Promise<number | undefined> {
    return this.balanceInstrument.getLastPriceForPair(pair);
  }

  async getLiveExposureSnapshot(): ReturnType<
    BybitLiveSnapshotService['getLiveExposureSnapshot']
  > {
    return this.liveSnapshot.getLiveExposureSnapshot();
  }

  async getSignalExecutionDebugSnapshot(
    signalId: string,
  ): Promise<SignalExecutionDebugSnapshot> {
    return this.liveSnapshot.getSignalExecutionDebugSnapshot(signalId);
  }

  async cleanupExchangeBeforeDeletingPlacedSignal(
    signalId: string,
  ): Promise<CloseSignalResult> {
    return this.exchangeCleanup.cleanupExchangeBeforeDeletingPlacedSignal(signalId);
  }

  async closeSignalManually(signalId: string): Promise<CloseSignalResult> {
    return this.bybitPositionClose.closeSignalManually(signalId, {
      normalizeTradingPair,
      orders: this.orders,
      getClient: () => this.balanceInstrument.getClient(),
      flattenLinearSymbolOnExchange: (client, symbol) =>
        this.exchangeCleanup.flattenLinearSymbolOnExchange(client, symbol),
      appLog: this.appLog,
      isFilledOrderStatus: (status) => isFilledOrderStatus(status),
      notifyApiTradeCancelled: (signal, reason) =>
        this.bybitNotify.notifyApiTradeCancelled(signal, reason),
    });
  }

  async processTradeCancelledNotificationJob(params: {
    signalIds: string[];
    reason: string;
  }): Promise<void> {
    await this.bybitNotify.processTradeCancelledNotificationJob(params);
  }

  async placeSignalOrders(
    signal: SignalDto,
    rawMessage: string | undefined,
    origin?: { chatId?: string; messageId?: string; signalExternalId?: string },
  ): Promise<PlaceOrdersResult> {
    const pv = this.placementValidation;
    const bal = this.balanceInstrument;
    const ov = this.signalOverrides;
    return this.bybitSignalPlacement.placeSignalOrders(signal, rawMessage, origin, {
      settings: this.settings,
      appLog: this.appLog,
      orders: this.orders,
      placementLocks: this.placementLocks,
      getClient: () => this.balanceInstrument.getClient(),
      applySourceMartingaleSizing: (s: SignalDto) => ov.applySourceMartingaleSizing(s),
      applyForcedLeverage: (s: SignalDto, o?: { chatId?: string; messageId?: string; signalExternalId?: string }) =>
        ov.applyForcedLeverage(s, o),
      hasExchangeExposureForDirection: (client: RestClientV5, symbol: string, direction: 'long' | 'short') =>
        this.bybitExposure.hasExchangeExposureForDirection(client, symbol, direction),
      clearImmediateStaleDbBlockerIfExchangeFlat: (
        pair: string,
        direction: 'long' | 'short',
        client: RestClientV5,
        reason: string,
      ) => this.clearImmediateStaleDbBlockerIfExchangeFlat(pair, direction, client, reason),
      buildPlacementLockKey: (pair: string, direction: 'long' | 'short') =>
        pv.buildPlacementLockKey(pair, direction),
      getLastPrice: (client: RestClientV5, symbol: string) => bal.getLastPrice(client, symbol),
      validateSignalLevels: (s: SignalDto, lastPrice?: number) => pv.validateSignalLevels(s, lastPrice),
      getUsdtBalanceDetails: (client: RestClientV5) => bal.getUsdtBalanceDetails(client),
      getLinearInstrumentFilters: (client: RestClientV5, symbol: string) =>
        bal.getLinearInstrumentFilters(client, symbol),
      applyEntryRangeResolution: (s: SignalDto, lastPrice: number | undefined, tickSize: string) =>
        pv.applyEntryRangeResolution(s, lastPrice, tickSize),
      resolveBumpToMinExchangeLot: (chatId?: string) => ov.resolveBumpToMinExchangeLot(chatId),
      validateLeveragedNotionalVsMinQty: (input: Parameters<
        BybitPlacementValidationService['validateLeveragedNotionalVsMinQty']
      >[0]) => pv.validateLeveragedNotionalVsMinQty(input),
      resolveEntryPositionIdx: (client: RestClientV5, symbol: string, side: 'Buy' | 'Sell') =>
        pv.resolveEntryPositionIdx(client, symbol, side),
      roundQty: (qtyNum: number, qtyStep: string, minQty: string) =>
        pv.roundQty(qtyNum, qtyStep, minQty),
      snapPriceToTickNum: (price: number, tickSize: string) =>
        pv.snapPriceToTickNum(price, tickSize),
      isInsufficientBalanceError: (msg: string | null | undefined) =>
        isInsufficientBalanceError(msg),
    });
  }

  async wouldDuplicateActivePairDirection(
    pair: string,
    direction: 'long' | 'short',
  ): Promise<boolean> {
    const symbol = normalizeTradingPair(pair);
    const client = await this.balanceInstrument.getClient();
    if (client) {
      try {
        const busy = await this.bybitExposure.hasExchangeExposureForDirection(
          client,
          symbol,
          direction,
        );
        if (busy) {
          return true;
        }
        await this.clearImmediateStaleDbBlockerIfExchangeFlat(symbol, direction, client, 'duplicate-check');
        return false;
      } catch (e) {
        this.logger.warn(`wouldDuplicateActivePairDirection: ${formatError(e)}`);
      }
    }
    return this.orders.hasActiveSignalForPairAndDirection(pair, direction);
  }

  async getTradePnlBreakdown(signalId: string): Promise<TradePnlBreakdownResult> {
    return this.bybitPnl.getTradePnlBreakdown({
      signalId,
      getSignalWithOrders: (id) => this.orders.getSignalWithOrders(id),
      getClient: () => this.balanceInstrument.getClient(),
    });
  }

  startRecalcClosedSignalsPnlJob(params?: {
    limit?: number;
    dryRun?: boolean;
  }): RecalcClosedPnlJobStatus {
    const dryRun = params?.dryRun ?? true;
    const limit = params?.limit ?? 200;
    const jobId = `recalc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    const job: RecalcClosedPnlJobStatus = {
      jobId,
      status: 'queued',
      dryRun,
      limit,
      createdAt,
    };
    this.bybitRecalc.registerRecalcJob(job);
    void this.prisma.recalcClosedPnlJob.upsert({
      where: { id: jobId },
      create: {
        id: jobId,
        status: 'queued',
        dryRun,
        limit,
      },
      update: {
        status: 'queued',
        dryRun,
        limit,
        error: null,
        resultJson: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    void this.workers.enqueueRecalcJob({
      jobId,
      dryRun,
      limit,
      cabinetId: this.currentCabinetId(),
    });

    return { ...job };
  }

  async processRecalcClosedPnlQueueJob(params: {
    jobId: string;
    dryRun: boolean;
    limit: number;
  }): Promise<void> {
    await this.bybitRecalc.processRecalcClosedPnlQueueJob(params, {
      recalcClosedSignalsPnl: (p) => this.recalcClosedSignalsPnl(p),
    });
  }

  async getRecalcClosedPnlJobStatus(
    jobId: string,
  ): Promise<RecalcClosedPnlJobStatus | null> {
    return this.bybitRecalc.getRecalcClosedPnlJobStatus(jobId);
  }

  async recalcClosedSignalsPnl(params?: {
    limit?: number;
    dryRun?: boolean;
  }): Promise<RecalcClosedPnlResult> {
    return this.bybitRecalc.recalcClosedSignalsPnl(params, {
      getClient: () => this.balanceInstrument.getClient(),
      buildClosedPnlWindow: (signalCreatedAt: Date, signalClosedAt?: Date | null) =>
        this.bybitPnl.buildClosedPnlWindow(signalCreatedAt, signalClosedAt),
      fetchClosedPnlRowsForSymbol: (
        client: RestClientV5,
        symbol: string,
        startTime: number,
        endTime: number,
      ) => this.bybitPnl.fetchClosedPnlRowsForSymbol(client, symbol, startTime, endTime),
      sumClosedPnlForSignal: (
        rows: unknown[],
        ourIds: Set<string>,
        direction: string,
        signalCreatedAt: Date,
        signalClosedAt?: Date | null,
      ) => this.bybitPnl.sumClosedPnlForSignal(rows, ourIds, direction, signalCreatedAt, signalClosedAt),
      estimateClosedPnlFromExecutions: (recalcParams) =>
        this.bybitPnl.estimateClosedPnlFromExecutions(recalcParams),
    });
  }

  async pollOpenOrders(): Promise<void> {
    await this.bybitOrderLifecyclePoll.pollOpenOrders({
      getClient: () => this.balanceInstrument.getClient(),
      orders: this.orders,
      stalePairDirectionKey: (pair: string, direction: 'long' | 'short') =>
        this.stalePairDirectionKey(pair, direction),
      staleFlatPollCounts: this.staleFlatPollCounts,
      staleReconcileSuspensions: this.staleReconcileSuspensions,
      appLog: this.appLog,
      hasExchangeExposureForDirection: (
        client: RestClientV5,
        symbol: string,
        direction: 'long' | 'short',
      ) => this.bybitExposure.hasExchangeExposureForDirection(client, symbol, direction),
      notifyStaleReconcileTradeCancelled: (signalIds: string[], reason: string) =>
        this.bybitNotify.notifyStaleReconcileTradeCancelled(signalIds, reason),
      fetchOrderStatusFromExchange: (
        client: RestClientV5,
        pair: string,
        orderId: string,
        expectedQty?: number,
      ) =>
        this.orderExchangeQuery.fetchOrderStatusFromExchange(
          client,
          pair,
          orderId,
          expectedQty,
        ),
      isFilledOrderStatus: (status: string | null | undefined) =>
        isFilledOrderStatus(status),
      ensureStopLossForMultiTpOpenPosition: (client: RestClientV5, fresh: any) =>
        this.ensureStopLossForMultiTpOpenPosition(client, fresh),
      placeTpSplitIfNeeded: (client: RestClientV5, fresh: any) =>
        this.placeTpSplitIfNeeded(client, fresh),
      stepStopLossIfTpFilled: (client: RestClientV5, fresh: any) =>
        this.stepStopLossIfTpFilled(client, fresh),
      finalizeSignalCloseIfNeeded: (client: RestClientV5, fresh: any) =>
        this.pollFinalize.finalizeSignalCloseIfNeeded(client, fresh),
    });
  }

  private async ensureStopLossForMultiTpOpenPosition(
    client: RestClientV5,
    sig: {
      id: string;
      pair: string;
      direction: string;
      stopLoss: number;
      takeProfits: string;
      orders: { orderKind: string }[];
    },
  ): Promise<void> {
    return this.bybitTpSl.ensureStopLossForMultiTpOpenPosition(client, sig, {
      pickPositionRowForSignalDirection,
    });
  }

  private async stepStopLossIfTpFilled(
    client: RestClientV5,
    fresh: {
      id: string;
      pair: string;
      direction: string;
      source: string | null;
      stopLoss: number;
      takeProfits: string;
      tpSlStep: number;
      orders: { orderKind: string; price: number | null; status: string | null }[];
    },
  ): Promise<void> {
    const pv = this.placementValidation;
    const bal = this.balanceInstrument;
    await this.bybitTpSl.stepStopLossIfTpFilled(client, fresh, {
      settings: this.settings,
      prisma: this.prisma,
      orders: this.orders,
      getCabinetSourceByTitle: (title: string) =>
        this.signalOverrides.getCabinetSourceByTitle(title),
      getLinearInstrumentFilters: (c: RestClientV5, s: string) =>
        bal.getLinearInstrumentFilters(c, s),
      formatPriceToTick: (price: number, tickSize: string) =>
        pv.formatPriceToTick(price, tickSize),
      snapPriceToTickNum: (price: number, tickSize: string) =>
        pv.snapPriceToTickNum(price, tickSize),
      isFilledOrderStatus: (status: string | null | undefined) =>
        isFilledOrderStatus(status),
    });
  }

  private async placeTpSplitIfNeeded(
    client: RestClientV5,
    fresh: {
      id: string;
      pair: string;
      direction: string;
      stopLoss: number;
      takeProfits: string;
      orders: {
        id: string;
        orderKind: string;
        status: string | null;
        bybitOrderId: string | null;
        qty: number | null;
        createdAt: Date;
      }[];
    },
  ): Promise<void> {
    await this.bybitTpSl.placeTpSplitIfNeeded(client, fresh, {
      placeTpSplitIfNeededPort: async () => {},
    });
  }

  private stalePairDirectionKey(
    pair: string,
    direction: 'long' | 'short',
  ): string {
    return stalePairDirectionKeyUtil(pair, direction);
  }

  private async clearImmediateStaleDbBlockerIfExchangeFlat(
    pair: string,
    direction: 'long' | 'short',
    client: RestClientV5,
    reason: string,
  ): Promise<number> {
    const symbol = normalizeTradingPair(pair);
    const reconcileKey = this.stalePairDirectionKey(symbol, direction);
    if (this.staleReconcileSuspensions.has(reconcileKey)) {
      return 0;
    }
    const hasDbBlocker = await this.orders.hasActiveSignalForPairAndDirection(symbol, direction);
    if (!hasDbBlocker) {
      return 0;
    }

    let cleanObservations = 0;
    for (let i = 0; i < 3; i += 1) {
      const busy = await this.bybitExposure.hasExchangeExposureForDirection(client, symbol, direction);
      if (busy) {
        void this.appLog.append(
          'debug',
          'bybit',
          'immediate stale blocker cleanup skipped because exchange exposure exists',
          {
            symbol,
            direction,
            reason,
            cleanObservations,
          },
        );
        return 0;
      }
      cleanObservations += 1;
      if (i < 2) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    const reconciledIds = await this.orders.reconcileStaleOpenSignalsForPairAndDirection(
      symbol,
      direction,
    );
    if (reconciledIds.length > 0) {
      this.staleFlatPollCounts.delete(reconcileKey);
      void this.appLog.append(
        'info',
        'bybit',
        'immediate stale blocker cleaned before duplicate/place check',
        {
          symbol,
          direction,
          reason,
          cleanObservations,
          signalsUpdated: reconciledIds.length,
        },
      );
      void this.bybitNotify.notifyStaleReconcileTradeCancelled(
        reconciledIds,
        'Синхронизация с Bybit: на бирже нет ордеров/позиции, сделка закрыта в учёте',
      );
    }
    return reconciledIds.length;
  }

  suspendStaleReconcile(
    pair: string,
    direction: 'long' | 'short',
    reason?: string,
  ): void {
    const key = this.stalePairDirectionKey(pair, direction);
    const prev = this.staleReconcileSuspensions.get(key);
    this.staleFlatPollCounts.delete(key);
    this.staleReconcileSuspensions.set(key, {
      count: (prev?.count ?? 0) + 1,
      reason: reason ?? prev?.reason,
    });
    void this.appLog.append('debug', 'bybit', 'stale reconcile suspended', {
      symbol: normalizeTradingPair(pair),
      direction,
      reason: reason ?? null,
      lockCount: (prev?.count ?? 0) + 1,
    });
  }

  resumeStaleReconcile(
    pair: string,
    direction: 'long' | 'short',
  ): void {
    const key = this.stalePairDirectionKey(pair, direction);
    const prev = this.staleReconcileSuspensions.get(key);
    if (!prev) {
      return;
    }
    if (prev.count <= 1) {
      this.staleReconcileSuspensions.delete(key);
      void this.appLog.append('debug', 'bybit', 'stale reconcile resumed', {
        symbol: normalizeTradingPair(pair),
        direction,
      });
      return;
    }
    this.staleReconcileSuspensions.set(key, {
      count: prev.count - 1,
      reason: prev.reason,
    });
    void this.appLog.append('debug', 'bybit', 'stale reconcile suspension decremented', {
      symbol: normalizeTradingPair(pair),
      direction,
      lockCount: prev.count - 1,
    });
  }
}
