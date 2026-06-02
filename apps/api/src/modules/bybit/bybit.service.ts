import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { formatError } from '../../common/format-error';
import {
  applyMarketEntryPrice,
  hasExplicitEntryPrices,
} from '../../common/signal-market-entry.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { CabinetService } from '../cabinet/cabinet.service';
import { OrdersService } from '../orders/orders.service';
import { BybitSpotInstrumentService } from '../bybit-spot/instrument/bybit-spot-instrument.service';
import { BybitSpotService } from '../bybit-spot/bybit-spot.service';
import { SettingsService } from '../settings/settings.service';
import { WorkerQueueService } from '../worker-queue/worker-queue.service';
import { stalePairDirectionKey as stalePairDirectionKeyUtil } from './exposure/bybit-exposure.util';
import { BybitBalanceInstrumentService } from './instrument/bybit-balance-instrument.service';
import { BybitClientService } from './instrument/bybit-client.service';
import { BybitRateLimitService } from './instrument/bybit-rate-limit.service';
import { BybitExchangeCleanupService } from './position/bybit-exchange-cleanup.service';
import { BybitExposureService } from './exposure/bybit-exposure.service';
import { BybitLiveSnapshotService } from './exposure/bybit-live-snapshot.service';
import { BybitNotifyService } from './notify/bybit-notify.service';
import { BybitOrderExchangeQueryService } from './orders/bybit-order-exchange-query.service';
import { BybitPlacementValidationService } from './orders/bybit-placement-validation.service';
import { BybitOrderLifecyclePollService } from './orders/bybit-order-lifecycle-poll.service';
import { createLinearPollOrdersPorts } from './orders/bybit-order-lifecycle-poll-orders.util';
import { emitOrderFillEventsIfNew } from './orders/bybit-order-fill-events.util';
import {
  applyTpSlForSignal,
  isFastTpSlApplyComplete,
  syncSignalOrderStatusesFromExchange,
  type PollSignalRow,
} from './orders/bybit-order-lifecycle-poll-signal.util';
import {
  hasLiveTpOrders,
  hasOpenEntryOrders,
  isFilledOrderStatus,
  isInsufficientBalanceError,
  isOpenOrderStatus,
} from './orders/bybit-order-status.util';
import type { ApplyTpSlManuallyResult } from './types/bybit-apply-tpsl.types';
import { positionHasStopLoss } from './tpsl/bybit-tpsl.util';
import { pickPositionRowForSignalDirection } from './position/bybit-position-pick.util';
import { BybitPollFinalizeService } from './poll/bybit-poll-finalize.service';
import { BybitPnlService } from './pnl/bybit-pnl.service';
import { BybitPositionCloseService } from './position/bybit-position-close.service';
import { BybitRecalcService } from './pnl/bybit-recalc.service';
import { BybitSignalOverridesService } from './overrides/bybit-signal-overrides.service';
import { BybitSignalPlacementService } from './orders/bybit-signal-placement.service';
import { BybitTpSlService } from './tpsl/bybit-tpsl.service';
import { BybitTpSlFastApplyService } from './tpsl/bybit-tpsl-fast-apply.service';
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
export class BybitService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BybitService.name);
  private readonly staleFlatPollCounts = new Map<string, number>();
  private readonly staleReconcileSuspensions = new Map<string, { count: number; reason?: string }>();
  private readonly placementLocks = new Set<string>();
  private readonly tpSplitInFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cabinetContext: CabinetContextService,
    private readonly cabinets: CabinetService,
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
    private readonly bybitRateLimit: BybitRateLimitService,
    private readonly placementValidation: BybitPlacementValidationService,
    private readonly signalOverrides: BybitSignalOverridesService,
    private readonly liveSnapshot: BybitLiveSnapshotService,
    private readonly pollFinalize: BybitPollFinalizeService,
    private readonly exchangeCleanup: BybitExchangeCleanupService,
    @Inject(forwardRef(() => BybitSpotService))
    private readonly bybitSpot: BybitSpotService,
    private readonly bybitSpotInstrument: BybitSpotInstrumentService,
    @Inject(forwardRef(() => BybitTpSlFastApplyService))
    private readonly fastTpSl: BybitTpSlFastApplyService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const tryStart = async (): Promise<boolean> =>
      this.bybitClient.startPrivateWsSync({
        onWsUpdate: () => this.workers.enqueuePollSweep('bybit-ws-update', 100),
      });
    const ok = await tryStart();
    if (!ok) {
      setTimeout(() => {
        void tryStart();
      }, 10_000);
    }
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

  async getSpotLastPriceForPair(pair: string): Promise<number | undefined> {
    const client = await this.bybitSpotInstrument.getClient();
    if (!client) {
      return undefined;
    }
    return this.bybitSpotInstrument.getSpotLastPrice(client, normalizeTradingPair(pair));
  }

  /**
   * Рыночный вход без явной цены в сигнале — подставляем last price на момент вызова.
   */
  async resolveMarketEntryIfMissing(
    signal: SignalDto,
    marketType: 'linear' | 'spot' = 'linear',
  ): Promise<SignalDto> {
    if (hasExplicitEntryPrices(signal.entries)) {
      return signal;
    }
    const lastPrice =
      marketType === 'spot'
        ? await this.getSpotLastPriceForPair(signal.pair)
        : await this.getLastPriceForPair(signal.pair);
    if (!lastPrice) {
      this.logger.warn(
        `resolveMarketEntryIfMissing: last price unavailable for ${signal.pair} (${marketType})`,
      );
      return signal;
    }
    return applyMarketEntryPrice(signal, lastPrice);
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

  /** Есть ли на бирже позиция/экспозиция по направлению сигнала (при ошибке API — true, консервативно). */
  async hasExchangeExposureForSignal(signalId: string): Promise<boolean> {
    const signal = await this.orders.getSignalWithOrders(signalId);
    if (!signal) {
      return false;
    }
    const client = await this.balanceInstrument.getClient();
    if (!client) {
      return true;
    }
    const symbol = normalizeTradingPair(signal.pair);
    const direction = signal.direction === 'short' ? 'short' : 'long';
    return this.bybitExposure.hasExchangeExposureForDirection(client, symbol, direction);
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
    const pollCabinetId = this.currentCabinetId();
    const result = await this.bybitSignalPlacement.placeSignalOrders(
      signal,
      rawMessage,
      origin,
      await this.createSignalPlacementPorts(),
    );
    if (result.ok) {
      if (result.signalId && pollCabinetId) {
        this.fastTpSl.scheduleFastTpSlApply(
          pollCabinetId,
          result.signalId,
          'post-placement',
        );
      }
      void this.scheduleOpenOrdersPollAsync('post-placement', 200, pollCabinetId);
    }
    return result;
  }

  /** Одна попытка fast TP/SL для конкретного сигнала (в cabinet context). */
  async runFastTpSlApplyAttempt(
    signalId: string,
    reason: string,
    attemptNum: number,
  ): Promise<{ done: boolean }> {
    const ports = await this.createOrderLifecyclePollPorts();
    const client = await ports.getClient();
    if (!client) {
      return { done: false };
    }

    void this.appLog.append('debug', 'bybit', 'TP_SL_FAST_APPLY: attempt', {
      signalId,
      reason,
      attempt: attemptNum,
    });

    const sig = (await ports.orders.getSignalWithOrders(signalId)) as PollSignalRow | null;
    if (!sig) {
      return { done: true };
    }

    await syncSignalOrderStatusesFromExchange(ports, client, sig, (msg) =>
      this.logger.debug(`fast apply ${msg}`),
    );

    const fresh = (await ports.orders.getSignalWithOrders(signalId)) as PollSignalRow | null;
    if (!fresh) {
      return { done: true };
    }

    await emitOrderFillEventsIfNew(ports, sig, fresh);

    await applyTpSlForSignal(ports, client, fresh, (label, err) =>
      this.logger.warn(`${label}: ${formatError(err)}`),
    );

    const after = (await ports.orders.getSignalWithOrders(signalId)) as PollSignalRow | null;
    if (!after) {
      return { done: true };
    }

    return { done: isFastTpSlApplyComplete(after) };
  }

  /**
   * Ручная синхронизация ордеров с Bybit и постановка TP/SL (UI / восстановление после сбоя poll).
   */
  async applyTpSlManually(
    signalId: string,
    context: 'manual' | 'auto-heal' = 'manual',
  ): Promise<ApplyTpSlManuallyResult> {
    const id = signalId.trim();
    if (!id) {
      return {
        ok: false,
        error: 'signalId обязателен',
        synced: false,
        entriesComplete: false,
        liveTpCount: 0,
        positionHasSl: false,
        positionSize: 0,
        complete: false,
        message: 'Не указан signalId',
      };
    }

    const pollCabinetId = this.currentCabinetId();
    if (pollCabinetId) {
      const released = await this.workers.releaseStalePollJobForCabinet(pollCabinetId);
      if (released) {
        void this.appLog.append('info', 'bybit', 'applyTpSlManually: сброшен зависший poll-cabinet', {
          cabinetId: pollCabinetId,
          signalId: id,
        });
      }
    }

    const before = (await this.orders.getSignalWithOrders(id)) as PollSignalRow | null;
    if (!before) {
      return {
        ok: false,
        error: 'Сделка не найдена',
        synced: false,
        entriesComplete: false,
        liveTpCount: 0,
        positionHasSl: false,
        positionSize: 0,
        complete: false,
        message: 'Сделка не найдена',
      };
    }

    const activeStatuses = new Set(['ORDERS_PLACED', 'OPEN', 'PARSED']);
    if (!activeStatuses.has(String(before.status ?? ''))) {
      return {
        ok: false,
        error: 'Сделка не активна',
        synced: false,
        entriesComplete: false,
        liveTpCount: 0,
        positionHasSl: false,
        positionSize: 0,
        complete: false,
        message: `Статус ${before.status}: TP/SL доступны только для активных сделок`,
      };
    }

    if (String((before as { marketType?: string }).marketType ?? 'linear') !== 'linear') {
      return {
        ok: false,
        error: 'Только linear',
        synced: false,
        entriesComplete: false,
        liveTpCount: 0,
        positionHasSl: false,
        positionSize: 0,
        complete: false,
        message: 'Ручная постановка TP/SL поддерживается только для linear',
      };
    }

    void this.appLog.append('info', 'bybit', `applyTpSlManually: старт (${context})`, {
      signalId: id,
      pair: before.pair,
      status: before.status,
      context,
    });

    let complete = false;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const step = await this.runFastTpSlApplyAttempt(id, context, attempt);
      complete = step.done;
      if (complete) {
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    const after = (await this.orders.getSignalWithOrders(id)) as PollSignalRow | null;
    const exposure = await this.buildManualApplyExposure(after);

    let message: string;
    if (complete) {
      message = 'TP/SL синхронизированы и установлены (или уже были на месте)';
    } else if (exposure.positionSize > 0 && exposure.liveTpCount === 0) {
      message =
        'Позиция на бирже есть, но TP не выставлены — проверьте minQty лота или логи Bybit';
    } else if (!exposure.entriesComplete) {
      message =
        'Вход ещё не исполнен на бирже — дождитесь fill или проверьте условный ордер входа';
    } else {
      message = 'Синхронизация выполнена, но TP/SL могли быть выставлены частично — проверьте Bybit';
    }

    void this.appLog.append(complete ? 'info' : 'warn', 'bybit', `applyTpSlManually: завершено (${context})`, {
      signalId: id,
      complete,
      context,
      ...exposure,
    });

    if (pollCabinetId) {
      void this.scheduleOpenOrdersPollAsync(`${context}-apply-tpsl`, 100, pollCabinetId);
    }

    return {
      ok: complete || exposure.liveTpCount > 0 || exposure.positionHasSl,
      synced: true,
      entriesComplete: exposure.entriesComplete,
      liveTpCount: exposure.liveTpCount,
      positionHasSl: exposure.positionHasSl,
      positionSize: exposure.positionSize,
      complete,
      message,
    };
  }

  private async buildManualApplyExposure(
    sig: PollSignalRow | null,
  ): Promise<{
    entriesComplete: boolean;
    liveTpCount: number;
    positionHasSl: boolean;
    positionSize: number;
  }> {
    if (!sig) {
      return {
        entriesComplete: false,
        liveTpCount: 0,
        positionHasSl: false,
        positionSize: 0,
      };
    }

    const entriesComplete = !hasOpenEntryOrders(sig.orders);
    const liveTpCount = sig.orders.filter((o) => o.orderKind === 'TP' && hasLiveTpOrders([o])).length;

    let positionSize = 0;
    let positionHasSl = false;
    try {
      const client = await this.balanceInstrument.getClient();
      if (client) {
        const symbol = normalizeTradingPair(sig.pair);
        const dir = sig.direction === 'short' ? 'short' : 'long';
        const posRes = await this.bybitRateLimit.runBybitCall(() =>
          client.getPositionInfo({ category: 'linear', symbol }),
        );
        if (posRes.retCode === 0) {
          const row = pickPositionRowForSignalDirection(posRes.result?.list ?? [], dir);
          positionSize = row?.size ? Math.abs(parseFloat(String(row.size))) : 0;
          positionHasSl = positionHasStopLoss(row);
        }
      }
    } catch (e) {
      this.logger.debug(`buildManualApplyExposure: ${formatError(e)}`);
    }

    return { entriesComplete, liveTpCount, positionHasSl, positionSize };
  }

  /**
   * Ближайший poll (TP/SL, статусы ордеров) без ожидания POLLING_INTERVAL_MS.
   * @param cabinetId — активный кабинет контекста; без него — sweep по всем кабинетам (не дефолтный один).
   */
  scheduleOpenOrdersPoll(reason: string, delayMs = 200, cabinetId?: string | null): void {
    void this.scheduleOpenOrdersPollAsync(reason, delayMs, cabinetId ?? this.currentCabinetId());
  }

  private async scheduleOpenOrdersPollAsync(
    reason: string,
    delayMs: number,
    cabinetId?: string | null,
  ): Promise<void> {
    const id = cabinetId?.trim();
    if (id) {
      if (!(await this.cabinets.isCabinetActive(id))) {
        return;
      }
      await this.workers.enqueueCabinetPoll(id, reason, delayMs);
      return;
    }
    this.logger.debug(
      `scheduleOpenOrdersPoll(${reason}): нет cabinet context — poll sweep всех кабинетов`,
    );
    await this.workers.enqueuePollSweep(reason, delayMs);
  }

  async wouldDuplicateActivePairDirection(
    pair: string,
    direction: 'long' | 'short',
  ): Promise<boolean> {
    const symbol = normalizeTradingPair(pair);
    const client = await this.balanceInstrument.getClient();
    if (client) {
      try {
        const verdict = await this.bybitExposure.getExchangeExposureVerdict(
          client,
          symbol,
          direction,
        );
        if (verdict === 'exposed') {
          return true;
        }
        if (verdict === 'unknown') {
          return this.orders.hasActiveSignalForPairAndDirection(pair, direction);
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
    const cabinetId = this.currentCabinetId();
    if (cabinetId && !(await this.cabinets.isCabinetActive(cabinetId))) {
      return;
    }
    await this.bybitOrderLifecyclePoll.pollOpenOrders(
      await this.createOrderLifecyclePollPorts(),
    );
    await this.bybitSpot.pollSpotSignals();
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

  private async resolveCabinetSegmentForKeys(): Promise<string> {
    return this.currentCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
  }

  private async createSignalPlacementPorts(): Promise<BybitSignalPlacementPorts> {
    const cabinetSegment = await this.resolveCabinetSegmentForKeys();
    const pv = this.placementValidation;
    const bal = this.balanceInstrument;
    const ov = this.signalOverrides;
    return {
      settings: this.settings,
      appLog: this.appLog,
      orders: {
        hasActiveSignalForPairAndDirection: (pair, direction) =>
          this.orders.hasActiveSignalForPairAndDirection(pair, direction),
        findActiveSignalTradeSnapshotForPairAndDirection: (pair, direction) =>
          this.orders.findActiveSignalTradeSnapshotForPairAndDirection(pair, direction),
        createSignalRecord: (signal, rawMessage, status, origin) =>
          this.orders.createSignalRecord(signal, rawMessage, status, origin),
        createOrderRecord: (data) => this.orders.createOrderRecord(data),
        updateSignalStatus: (signalId, data) => this.orders.updateSignalStatus(signalId, data),
        createSignalEvent: (signalId, type, payload) =>
          this.orders.createSignalEvent(signalId, type, payload),
      },
      placementLocks: this.placementLocks,
      getClient: () => this.balanceInstrument.getClient(),
      applySourceMartingaleSizing: (s: SignalDto) => ov.applySourceMartingaleSizing(s),
      applyForcedLeverage: (s, o) => ov.applyForcedLeverage(s, o),
      hasExchangeExposureForDirection: (client, symbol, direction) =>
        this.bybitExposure.hasExchangeExposureForDirection(client, symbol, direction),
      isHedgeModeActiveForSymbol: async (client, symbol) => {
        try {
          const pos = await this.bybitRateLimit.runBybitCall(() =>
            client.getPositionInfo({ category: 'linear', symbol }),
          );
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
      buildPlacementLockKey: (pair, direction) =>
        pv.buildPlacementLockKey(cabinetSegment, pair, direction),
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
      notifyHedgeOppositePlacementAudit: (params) =>
        this.bybitNotify.notifyHedgeOppositePlacementAudit(params),
      preflightLinearPlacement: (pair) =>
        this.bybitSpotInstrument.preflightLinearPlacement(pair),
    };
  }

  private async createOrderLifecyclePollPorts(): Promise<BybitOrderLifecyclePollPorts> {
    const cabinetSegment = await this.resolveCabinetSegmentForKeys();
    const orders = this.orders;
    return {
      getClient: () => this.balanceInstrument.getClient(),
      orders: createLinearPollOrdersPorts(orders),
      stalePairDirectionKey: (pair, direction) =>
        stalePairDirectionKeyUtil(cabinetSegment, pair, direction),
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
      scheduleFastTpSlApply: (signalId, reason) => {
        const cab = this.currentCabinetId();
        if (cab) {
          this.fastTpSl.scheduleFastTpSlApply(cab, signalId, reason);
        }
      },
    };
  }

  private async ensureStopLossForMultiTpOpenPosition(
    client: RestClientV5,
    sig: {
      id: string;
      pair: string;
      direction: string;
      stopLoss: number;
      orders: { orderKind: string; status: string | null }[];
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
      status?: string;
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
    const cabinetSegment = await this.resolveCabinetSegmentForKeys();
    const lockKey = `${cabinetSegment}:${fresh.id}`;
    const existing = this.tpSplitInFlight.get(lockKey);
    if (existing) {
      await existing;
      return;
    }

    const pv = this.placementValidation;
    const work = this.bybitTpSl
      .placeTpSplitIfNeeded(client, fresh, {
        getLinearInstrumentFilters: (c, s) => this.balanceInstrument.getLinearInstrumentFilters(c, s),
        resolveEntryPositionIdx: (c, s, side) => pv.resolveEntryPositionIdx(c, s, side),
        formatPriceToTick: (p, t) => pv.formatPriceToTick(p, t),
        buildTpSplitDiagnostics: (p) => pv.buildTpSplitDiagnostics(p),
        orders: {
          createOrderRecord: (data) => this.orders.createOrderRecord(data),
          createSignalEvent: (signalId, type, payload) =>
            this.orders.createSignalEvent(signalId, type, payload),
        },
        appLog: this.appLog,
      })
      .finally(() => {
        this.tpSplitInFlight.delete(lockKey);
      });

    this.tpSplitInFlight.set(lockKey, work);
    await work;
  }

  private async clearImmediateStaleDbBlockerIfExchangeFlat(
    pair: string,
    direction: 'long' | 'short',
    client: RestClientV5,
    reason: string,
  ): Promise<number> {
    const symbol = normalizeTradingPair(pair);
    const cabinetSegment = await this.resolveCabinetSegmentForKeys();
    const reconcileKey = stalePairDirectionKeyUtil(cabinetSegment, symbol, direction);
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

  async suspendStaleReconcile(
    pair: string,
    direction: 'long' | 'short',
    reason?: string,
    cabinetId?: string | null,
  ): Promise<void> {
    const seg =
      cabinetId != null && cabinetId.trim() !== ''
        ? cabinetId.trim()
        : this.currentCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    const key = stalePairDirectionKeyUtil(seg, normalizeTradingPair(pair), direction);
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

  async resumeStaleReconcile(
    pair: string,
    direction: 'long' | 'short',
    cabinetId?: string | null,
  ): Promise<void> {
    const seg =
      cabinetId != null && cabinetId.trim() !== ''
        ? cabinetId.trim()
        : this.currentCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    const key = stalePairDirectionKeyUtil(seg, normalizeTradingPair(pair), direction);
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
