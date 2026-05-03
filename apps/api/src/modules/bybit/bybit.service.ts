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
import { stalePairDirectionKey as stalePairDirectionKeyUtil } from './exposure/bybit-exposure.util';
import { BybitBalanceInstrumentService } from './instrument/bybit-balance-instrument.service';
import { BybitClientService } from './instrument/bybit-client.service';
import { BybitExchangeCleanupService } from './position/bybit-exchange-cleanup.service';
import { BybitExposureService } from './exposure/bybit-exposure.service';
import { BybitLiveSnapshotService } from './exposure/bybit-live-snapshot.service';
import { BybitNotifyService } from './notify/bybit-notify.service';
import { BybitOrderExchangeQueryService } from './orders/bybit-order-exchange-query.service';
import { BybitPlacementValidationService } from './orders/bybit-placement-validation.service';
import { BybitOrderLifecyclePollService } from './orders/bybit-order-lifecycle-poll.service';
import {
  isFilledOrderStatus,
  isInsufficientBalanceError,
  isOpenOrderStatus,
} from './orders/bybit-order-status.util';
import { pickPositionRowForSignalDirection } from './position/bybit-position-pick.util';
import { BybitPollFinalizeService } from './poll/bybit-poll-finalize.service';
import { BybitPnlService } from './pnl/bybit-pnl.service';
import { BybitPositionCloseService } from './position/bybit-position-close.service';
import { BybitRecalcService } from './pnl/bybit-recalc.service';
import { BybitSignalOverridesService } from './overrides/bybit-signal-overrides.service';
import { BybitSignalPlacementService } from './orders/bybit-signal-placement.service';
import { BybitTpSlService } from './tpsl/bybit-tpsl.service';
import type {
  BybitOrderLifecyclePollPorts,
  BybitPositionClosePorts,
  BybitSignalPlacementPorts,
} from './types/bybit-ports.types';
import type {
  CloseSignalResult,
  PlaceOrdersResult,
  RecalcClosedPnlJobStatus,
  RecalcClosedPnlResult,
  SignalExecutionDebugSnapshot,
  SignalOrderOrigin,
  TradePnlBreakdownResult,
} from './types/bybit.types';

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

  // --- Public API: balance / snapshots / exchange cleanup ---

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
    return this.bybitPositionClose.closeSignalManually(
      signalId,
      this.createPositionClosePorts(),
    );
  }

  // --- Notifications ---

  async processTradeCancelledNotificationJob(params: {
    signalIds: string[];
    reason: string;
  }): Promise<void> {
    await this.bybitNotify.processTradeCancelledNotificationJob(params);
  }

  // --- Placement & duplicate guard ---

  async placeSignalOrders(
    signal: SignalDto,
    rawMessage: string | undefined,
    origin?: SignalOrderOrigin,
  ): Promise<PlaceOrdersResult> {
    return this.bybitSignalPlacement.placeSignalOrders(
      signal,
      rawMessage,
      origin,
      this.createSignalPlacementPorts(),
    );
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

  // --- PnL read ---

  async getTradePnlBreakdown(signalId: string): Promise<TradePnlBreakdownResult> {
    return this.bybitPnl.getTradePnlBreakdown({
      signalId,
      getSignalWithOrders: (id) => this.orders.getSignalWithOrders(id),
      getClient: () => this.balanceInstrument.getClient(),
    });
  }

  // --- Recalc closed PnL jobs ---

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

  // --- Poll open orders & TP/SL hooks ---

  async pollOpenOrders(): Promise<void> {
    await this.bybitOrderLifecyclePoll.pollOpenOrders(this.createOrderLifecyclePollPorts());
  }

  private createPositionClosePorts(): BybitPositionClosePorts {
    return {
      normalizeTradingPair,
      orders: this.orders,
      getClient: () => this.balanceInstrument.getClient(),
      flattenLinearSymbolOnExchange: (client, symbol) =>
        this.exchangeCleanup.flattenLinearSymbolOnExchange(client, symbol),
      getExchangeActiveOrders: (client, symbol) =>
        this.bybitExposure.getExchangeActiveOrders(client, symbol),
      getExchangePositions: (client, symbol) =>
        this.bybitExposure.getExchangePositions(client, symbol),
      getLotStep: (client, symbol) => this.balanceInstrument.getLotStep(client, symbol),
      formatQtyToStep: (qty, qtyStep) =>
        this.placementValidation.formatQtyToStep(qty, qtyStep),
      fetchOrderStatusFromExchange: (client, pair, orderId, expectedQty) =>
        this.orderExchangeQuery.fetchOrderStatusFromExchange(
          client,
          pair,
          orderId,
          expectedQty,
        ),
      appLog: this.appLog,
      isFilledOrderStatus: (status) => isFilledOrderStatus(status),
      isOpenOrderStatus: (status) => isOpenOrderStatus(status),
      notifyApiTradeCancelled: (signal, reason) =>
        this.bybitNotify.notifyApiTradeCancelled(signal, reason),
    };
  }

  private createSignalPlacementPorts(): BybitSignalPlacementPorts {
    const pv = this.placementValidation;
    const bal = this.balanceInstrument;
    const ov = this.signalOverrides;
    return {
      settings: this.settings,
      appLog: this.appLog,
      orders: this.orders,
      placementLocks: this.placementLocks,
      getClient: () => this.balanceInstrument.getClient(),
      applySourceMartingaleSizing: (s: SignalDto) => ov.applySourceMartingaleSizing(s),
      applyForcedLeverage: (s, o) => ov.applyForcedLeverage(s, o),
      hasExchangeExposureForDirection: (client, symbol, direction) =>
        this.bybitExposure.hasExchangeExposureForDirection(client, symbol, direction),
      isHedgeModeActiveForSymbol: async (client, symbol) => {
        try {
          const pos = await client.getPositionInfo({ category: 'linear', symbol });
          if (pos.retCode !== 0) {
            return false;
          }
          return (pos.result?.list ?? []).some((row) => {
            const idx = Number(row.positionIdx ?? 0);
            return idx === 1 || idx === 2;
          });
        } catch {
          return false;
        }
      },
      clearImmediateStaleDbBlockerIfExchangeFlat: (pair, direction, client, reason) =>
        this.clearImmediateStaleDbBlockerIfExchangeFlat(pair, direction, client, reason),
      buildPlacementLockKey: (pair, direction) => pv.buildPlacementLockKey(pair, direction),
      getLastPrice: (client, symbol) => bal.getLastPrice(client, symbol),
      validateSignalLevels: (s, lastPrice) => pv.validateSignalLevels(s, lastPrice),
      getUsdtBalanceDetails: (client) => bal.getUsdtBalanceDetails(client),
      getLinearInstrumentFilters: (client, symbol) => bal.getLinearInstrumentFilters(client, symbol),
      applyEntryRangeResolution: (s, lastPrice, tickSize) =>
        pv.applyEntryRangeResolution(s, lastPrice, tickSize),
      resolveBumpToMinExchangeLot: (chatId) => ov.resolveBumpToMinExchangeLot(chatId),
      validateLeveragedNotionalVsMinQty: (input) => pv.validateLeveragedNotionalVsMinQty(input),
      resolveEntryPositionIdx: (client, symbol, side) =>
        pv.resolveEntryPositionIdx(client, symbol, side),
      roundQty: (qtyNum, qtyStep, minQty) => pv.roundQty(qtyNum, qtyStep, minQty),
      snapPriceToTickNum: (price, tickSize) => pv.snapPriceToTickNum(price, tickSize),
      isInsufficientBalanceError: (msg) => isInsufficientBalanceError(msg),
    };
  }

  private createOrderLifecyclePollPorts(): BybitOrderLifecyclePollPorts {
    return {
      getClient: () => this.balanceInstrument.getClient(),
      orders: this.orders,
      stalePairDirectionKey: (pair, direction) => this.stalePairDirectionKey(pair, direction),
      staleFlatPollCounts: this.staleFlatPollCounts,
      staleReconcileSuspensions: this.staleReconcileSuspensions,
      appLog: this.appLog,
      hasExchangeExposureForDirection: (client, symbol, direction) =>
        this.bybitExposure.hasExchangeExposureForDirection(client, symbol, direction),
      notifyStaleReconcileTradeCancelled: (signalIds, reason) =>
        this.bybitNotify.notifyStaleReconcileTradeCancelled(signalIds, reason),
      fetchOrderStatusFromExchange: (client, pair, orderId, expectedQty) =>
        this.orderExchangeQuery.fetchOrderStatusFromExchange(
          client,
          pair,
          orderId,
          expectedQty,
        ),
      isFilledOrderStatus: (status) => isFilledOrderStatus(status),
      ensureStopLossForMultiTpOpenPosition: (client, fresh) =>
        this.ensureStopLossForMultiTpOpenPosition(client, fresh),
      placeTpSplitIfNeeded: (client, fresh) => this.placeTpSplitIfNeeded(client, fresh),
      stepStopLossIfTpFilled: (client, fresh) => this.stepStopLossIfTpFilled(client, fresh),
      finalizeSignalCloseIfNeeded: (client, fresh) =>
        this.pollFinalize.finalizeSignalCloseIfNeeded(client, fresh),
    };
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

  // --- Stale reconcile suspend / resume (public for callers outside poll) ---

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
