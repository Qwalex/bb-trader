import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { OrdersService } from '../orders/orders.service';
import { resolveForcedLeverageWithChatOverride } from '../settings/forced-leverage.util';
import {
  type TpSlStepStartMode,
} from '../settings/tp-sl-step.util';
import { SettingsService } from '../settings/settings.service';
import { WorkerQueueService } from '../worker-queue/worker-queue.service';
import {
  BYBIT_OPEN_ORDER_STATUSES,
  BYBIT_SOURCE_MAP_SKIP_LOG_CAP,
} from './bybit.constants';
import {
  isReduceOnlyOrClosingOrder,
  stalePairDirectionKey as stalePairDirectionKeyUtil,
} from './bybit-exposure.util';
import { BybitExposureService } from './bybit-exposure.service';
import { BybitClientService } from './bybit-client.service';
import { BybitNotifyService } from './bybit-notify.service';
import { BybitOrderLifecyclePollService } from './bybit-order-lifecycle-poll.service';
import { BybitPnlService } from './bybit-pnl.service';
import { BybitPositionCloseService } from './bybit-position-close.service';
import { BybitRecalcService } from './bybit-recalc.service';
import { BybitSignalPlacementService } from './bybit-signal-placement.service';
import {
  isClosedPnlLiquidationRow as isClosedPnlLiquidationRowUtil,
  isLiquidationExecutionRow as isLiquidationExecutionRowUtil,
} from './bybit-pnl.util';
import { positionHasStopLoss as positionHasStopLossUtil } from './bybit-tpsl.util';
import { BybitTpSlService } from './bybit-tpsl.service';
import {
  buildTpSplitDiagnostics as buildTpSplitDiagnosticsUtil,
  entryNotionalWeights as entryNotionalWeightsUtil,
  floorQtyToStepUnits as floorQtyToStepUnitsUtil,
  formatPriceToTick as formatPriceToTickUtil,
  formatQtyToStep as formatQtyToStepUtil,
  snapPriceToTickNum as snapPriceToTickNumUtil,
  splitPositionQtyForTps as splitPositionQtyForTpsUtil,
  splitQtyForChildOrders as splitQtyForChildOrdersUtil,
} from './bybit-qty.util';
import { parseSourceMultiplierMap } from './bybit-json.util';
import type {
  CloseSignalResult,
  LiveExposureItem,
  LiveExposureOrder,
  LiveExposurePosition,
  PlaceOrdersResult,
  RecalcClosedPnlJobStatus,
  RecalcClosedPnlResult,
  SignalExecutionDebugSnapshot,
  TradePnlBreakdownResult,
} from './bybit.types';

@Injectable()
export class BybitService implements OnModuleInit {
  private readonly logger = new Logger(BybitService.name);
  /**
   * Последнее невалидное значение глобального TP_SL_STEP_RANGE (trim): warn при смене «плохой» строки,
   * без спама; сброс когда значение пусто или валидно.
   */
  private lastWarnedInvalidGlobalTpSlRange: string | null = null;
  private readonly ladderSourceGlobalFallbackLogged = new Set<string>();
  private readonly sourceTpMapSkipLogged = new Set<string>();
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
  ) {}

  onModuleInit(): void {
    void this.bybitClient.startPrivateWsSync({
      onWsUpdate: () => this.workers.enqueuePollSweep('bybit-ws-update'),
    });
  }

  private currentCabinetId(): string | null {
    return this.cabinetContext.getCabinetId();
  }

  /**
   * Глобально: BUMP_TO_MIN_EXCHANGE_LOT (по умолчанию false).
   * По чату userbot: minLotBump — если задан, перекрывает глобальное значение.
   */
  private async resolveBumpToMinExchangeLot(chatId?: string): Promise<boolean> {
    const trimmed = chatId?.trim();
    if (trimmed) {
      const cabinetId = this.currentCabinetId();
      if (cabinetId) {
        const scoped = await this.prisma.cabinetTelegramSource.findUnique({
          where: { cabinetId_chatId: { cabinetId, chatId: trimmed } },
          select: { minLotBump: true },
        });
        if (scoped?.minLotBump != null) {
          return scoped.minLotBump;
        }
      }
      const row = await this.prisma.tgUserbotChat.findUnique({
        where: { chatId: trimmed },
        select: { minLotBump: true },
      });
      if (row?.minLotBump != null) {
        return row.minLotBump;
      }
    }
    const raw = await this.settings.get('BUMP_TO_MIN_EXCHANGE_LOT');
    return raw === 'true' || raw === '1';
  }

  private async getClient(): Promise<RestClientV5 | null> {
    return this.bybitClient.getClient();
  }

  /** Текущий USDT-баланс (best-effort) для внешних guard-проверок — доступные средства. */
  async getUnifiedUsdtBalance(): Promise<number | undefined> {
    const d = await this.getUnifiedUsdtBalanceDetails();
    return d?.availableUsd;
  }

  /** Доступный и суммарный (equity) USDT в unified-кошельке. */
  async getUnifiedUsdtBalanceDetails(): Promise<
    { availableUsd: number; totalUsd: number } | undefined
  > {
    const client = await this.getClient();
    if (!client) {
      return undefined;
    }
    try {
      const d = await this.getUsdtBalanceDetails(client);
      return Number.isFinite(d.availableUsd) && Number.isFinite(d.totalUsd) ? d : undefined;
    } catch (e) {
      this.logger.warn(`getUnifiedUsdtBalanceDetails failed: ${formatError(e)}`);
      return undefined;
    }
  }

  /** USDT: доступно для торговли и суммарный баланс (equity / wallet). */
  private async getUsdtBalanceDetails(
    client: RestClientV5,
  ): Promise<{ availableUsd: number; totalUsd: number }> {
    const accountTypes: Array<'UNIFIED' | 'CONTRACT'> = ['UNIFIED', 'CONTRACT'];
    const parseFinite = (v: unknown): number | undefined => {
      if (v == null || String(v).trim() === '') return undefined;
      const n = Number.parseFloat(String(v));
      return Number.isFinite(n) ? n : undefined;
    };
    const nonNegative = (v: number | undefined): number | undefined => {
      if (v === undefined || !Number.isFinite(v)) return undefined;
      return Math.max(0, v);
    };

    for (const accountType of accountTypes) {
      const res = await client.getWalletBalance({ accountType });
      const list = res.result?.list?.[0];
      const coin = list?.coin?.find((c) => c.coin === 'USDT');
      if (!coin) continue;

      const coinRec = coin as unknown as Record<string, unknown>;

      // 1) Прямые поля "доступно к использованию"
      const candidates: unknown[] = [
        coin.availableToWithdraw,
        coinRec.availableToTransfer,
        coinRec.transferBalance,
      ];
      let available: number | undefined;
      for (const candidate of candidates) {
        const parsed = parseFinite(candidate);
        if (parsed !== undefined) {
          available = nonNegative(parsed) ?? parsed;
          break;
        }
      }

      // 2) Вычисляемый fallback доступной маржи
      if (available === undefined) {
        const equity =
          parseFinite(coin.equity) ?? parseFinite(coin.walletBalance);
        const totalOrderIM = parseFinite(coinRec.totalOrderIM) ?? 0;
        const totalPositionIM = parseFinite(coinRec.totalPositionIM) ?? 0;
        if (equity !== undefined) {
          const computedAvailable = equity - totalOrderIM - totalPositionIM;
          available = nonNegative(computedAvailable);
        }
      }

      // 3) Последний fallback для доступного
      if (available === undefined) {
        const fallbackCandidates: unknown[] = [
          list?.totalAvailableBalance,
          coin.availableToBorrow,
          coin.walletBalance,
          coin.equity,
          list?.totalWalletBalance,
          list?.totalEquity,
        ];
        for (const candidate of fallbackCandidates) {
          const parsed = parseFinite(candidate);
          if (parsed !== undefined) {
            available = nonNegative(parsed) ?? parsed;
            break;
          }
        }
      }

      if (available !== undefined && Number.isFinite(available)) {
        const totalUsdRaw =
          parseFinite(coin.equity) ??
          parseFinite(coin.walletBalance) ??
          parseFinite(list?.totalEquity) ??
          parseFinite(list?.totalWalletBalance);
        const totalFromEquity = nonNegative(totalUsdRaw) ?? totalUsdRaw;
        const totalUsd =
          totalFromEquity !== undefined &&
          Number.isFinite(totalFromEquity) &&
          totalFromEquity > 0
            ? Math.max(totalFromEquity, available)
            : available;
        return { availableUsd: available, totalUsd };
      }
    }

    throw new Error('USDT balance is unavailable for current Bybit account');
  }

  /** USDT balance in unified derivatives wallet (best-effort) — только доступно. */
  private async getUsdtBalance(client: RestClientV5): Promise<number> {
    const d = await this.getUsdtBalanceDetails(client);
    return d.availableUsd;
  }

  /** Лот, мин. объём и шаг цены (для TP limit / trading-stop). */
  private async getLinearInstrumentFilters(
    client: RestClientV5,
    symbol: string,
  ): Promise<{ qtyStep: string; minQty: string; tickSize: string }> {
    const res = await client.getInstrumentsInfo({
      category: 'linear',
      symbol,
    });
    const info = res.result?.list?.[0];
    const lot = info?.lotSizeFilter;
    const price = info?.priceFilter;
    return {
      qtyStep: lot?.qtyStep ?? '0.001',
      minQty: lot?.minOrderQty ?? '0.001',
      tickSize: price?.tickSize ?? '0.0001',
    };
  }

  private async getLotStep(
    client: RestClientV5,
    symbol: string,
  ): Promise<{ qtyStep: string; minQty: string }> {
    const f = await this.getLinearInstrumentFilters(client, symbol);
    return { qtyStep: f.qtyStep, minQty: f.minQty };
  }

  /**
   * Last/mark/index для линейного контракта (котировка с биржи).
   * Используется для подстановки цены входа «по рынку», когда в сигнале не указан вход.
   */
  async getLastPriceForPair(pair: string): Promise<number | undefined> {
    const client = await this.getClient();
    if (!client) {
      return undefined;
    }
    const symbol = normalizeTradingPair(pair);
    return this.getLastPrice(client, symbol);
  }

  /** Последняя цена инструмента (best-effort). */
  private async getLastPrice(
    client: RestClientV5,
    symbol: string,
  ): Promise<number | undefined> {
    try {
      const t = await client.getTickers({
        category: 'linear',
        symbol,
      });
      if (t.retCode !== 0) return undefined;
      const row = t.result?.list?.[0];
      const v = Number(row?.lastPrice ?? row?.markPrice ?? row?.indexPrice);
      return Number.isFinite(v) && v > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Целое число шагов qtyStep в qty (без этого 0.3/0.1 в JS даёт 2.999… → floor = 2).
   */
  private static floorQtyToStepUnits(qty: number, stepNum: number): number {
    return floorQtyToStepUnitsUtil(qty, stepNum);
  }

  /** Округление количества к шагу лота (без подмешивания min на каждый кусок — это ломало split). */
  private formatQtyToStep(qty: number, qtyStep: string): string {
    return formatQtyToStepUtil(qty, qtyStep);
  }

  /** Цена лимитки по tickSize инструмента. */
  private formatPriceToTick(price: number, tickSize: string): string {
    return formatPriceToTickUtil(price, tickSize);
  }

  /** Цена на сетке тика — для сравнения с LastPrice (Rising/Falling требуют строгого неравенства). */
  private snapPriceToTickNum(price: number, tickSize: string): number {
    return snapPriceToTickNumUtil(price, tickSize);
  }

  private roundQty(qty: number, step: string, minQty: string): string {
    const stepNum = parseFloat(step);
    const min = parseFloat(minQty);
    // Округление вниз по шагу; min подмешивается только если выше заранее проверили,
    // что номинала хватает на minQty (validateLeveragedNotionalVsMinQty).
    const roundedDown =
      BybitService.floorQtyToStepUnits(qty, stepNum) * stepNum;
    const q = Math.max(roundedDown, min);
    const decimals = (step.split('.')[1] ?? '').length;
    return q.toFixed(decimals);
  }

  /**
   * Если расчётное qty < minQty биржи, roundQty() поднимет количество до minQty — фактический
   * номинал ордера станет больше заданного (например ~68 USDT вместо 6 на BTC при min 0.001).
   * Здесь отсекаем такие случаи: ордер не выставляем, пользователь видит понятную ошибку.
   */
  private validateLeveragedNotionalVsMinQty(params: {
    leveragedNotional: number;
    effectiveEntries: number[];
    weights: number[];
    lastPrice: number | undefined;
    minQtyNum: number;
    symbol: string;
  }): string | undefined {
    const {
      leveragedNotional,
      effectiveEntries,
      weights,
      lastPrice,
      minQtyNum,
      symbol,
    } = params;
    if (
      !Number.isFinite(leveragedNotional) ||
      leveragedNotional <= 0 ||
      !Number.isFinite(minQtyNum) ||
      minQtyNum <= 0
    ) {
      return undefined;
    }

    if (effectiveEntries.length === 0) {
      if (
        lastPrice == null ||
        !Number.isFinite(lastPrice) ||
        lastPrice <= 0
      ) {
        return undefined;
      }
      const qtyRaw = leveragedNotional / lastPrice;
      if (qtyRaw + 1e-12 < minQtyNum) {
        const minUsd = minQtyNum * lastPrice;
        return `Номинал ${leveragedNotional.toFixed(2)} USDT меньше минимального лота для ${symbol}: при цене ~${lastPrice.toFixed(2)} нужно не меньше ~${minUsd.toFixed(2)} USDT (мин. количество ${minQtyNum}).`;
      }
      return undefined;
    }

    for (let i = 0; i < effectiveEntries.length; i++) {
      const price = effectiveEntries[i]!;
      const share = weights[i] ?? 1 / effectiveEntries.length;
      const notionalSlice = leveragedNotional * share;
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }
      const qtyRaw = notionalSlice / price;
      if (qtyRaw + 1e-12 < minQtyNum) {
        const minUsd = minQtyNum * price;
        return `Доля номинала на вход ${i + 1} (${notionalSlice.toFixed(2)} USDT) меньше минимального лота для ${symbol}: при цене ~${price.toFixed(2)} нужно не меньше ~${minUsd.toFixed(2)} USDT (мин. количество ${minQtyNum}).`;
      }
    }
    return undefined;
  }

  /** Базовая валидация направления/уровней сигнала. */
  private validateSignalLevels(
    signal: SignalDto,
    marketEntryPrice?: number,
  ): string | undefined {
    const entries = signal.entries;
    if (!entries.length && !Number.isFinite(marketEntryPrice)) {
      return 'Не удалось определить цену рыночного входа';
    }
    const minEntry = entries.length
      ? Math.min(...entries)
      : Number(marketEntryPrice);
    const maxEntry = entries.length
      ? Math.max(...entries)
      : Number(marketEntryPrice);
    const sl = signal.stopLoss;
    const tps = signal.takeProfits;

    const primaryEntry = entries.length > 0 ? entries[0]! : Number(marketEntryPrice);
    if (signal.direction === 'long') {
      if (!(sl < minEntry)) {
        return `Некорректный SL для LONG: SL (${sl}) должен быть ниже входа (${minEntry}).`;
      }
      if (tps.some((tp) => tp <= primaryEntry)) {
        return `Некорректный TP для LONG: TP должен быть выше основного входа (${primaryEntry}).`;
      }
    } else {
      if (!(sl > maxEntry)) {
        return `Некорректный SL для SHORT: SL (${sl}) должен быть выше входа (${maxEntry}).`;
      }
      if (tps.some((tp) => tp >= primaryEntry)) {
        return `Некорректный TP для SHORT: TP должен быть ниже основного входа (${primaryEntry}).`;
      }
    }
    return undefined;
  }

  private buildPlacementLockKey(pair: string, direction: 'long' | 'short'): string {
    return `${normalizeTradingPair(pair)}:${direction}`;
  }

  private async resolveEntryPositionIdx(
    client: RestClientV5,
    symbol: string,
    side: 'Buy' | 'Sell',
  ): Promise<0 | 1 | 2> {
    try {
      const pos = await client.getPositionInfo({
        category: 'linear',
        symbol,
      });
      if (pos.retCode !== 0) {
        return 0;
      }
      const rows = pos.result?.list ?? [];
      const hasHedgeRows = rows.some((r) => {
        const idx = Number(r.positionIdx ?? 0);
        return idx === 1 || idx === 2;
      });
      if (!hasHedgeRows) {
        return 0;
      }
      return side === 'Buy' ? 1 : 2;
    } catch {
      return 0;
    }
  }

  /**
   * Доля номинала на каждый вход: первый 50%, остальные поровну на вторую половину
   * (2 входа → 50/50, 3 → 50/25/25, 4 → 50/16.67/…).
   */
  /**
   * Режим entryIsRange: [low, high] — одна зона. Если last внутри или на границе — рынок;
   * если снаружи — одна цена: ближайшая граница ± 10% ширины диапазона внутрь, по сетке тика.
   */
  private applyEntryRangeResolution(
    signal: SignalDto,
    lastPrice: number | undefined,
    tickSize: string,
  ):
    | { ok: true; effectiveEntries: number[]; weights: number[] }
    | { ok: false; error: string } {
    if (!signal.entryIsRange) {
      const effectiveEntries = signal.entries;
      return {
        ok: true,
        effectiveEntries,
        weights: this.entryNotionalWeights(effectiveEntries.length || 1),
      };
    }
    if (signal.entries.length !== 2) {
      return {
        ok: false,
        error:
          'Режим входа по диапазону: нужны ровно две границы зоны (нижняя и верхняя).',
      };
    }
    const a = signal.entries[0]!;
    const b = signal.entries[1]!;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const W = high - low;
    if (!Number.isFinite(W) || W < 0) {
      return {
        ok: false,
        error: 'Некорректный диапазон входа: границы совпадают или невалидны.',
      };
    }
    if (W === 0) {
      void this.appLog.append(
        'info',
        'bybit',
        'placeSignalOrders: диапазон входа с равными границами преобразован в один вход',
        {
          pair: signal.pair,
          low,
          high,
          effectiveEntry: low,
        },
      );
      return { ok: true, effectiveEntries: [low], weights: [1] };
    }
    const inset = 0.1 * W;
    if (lastPrice === undefined || !Number.isFinite(lastPrice) || lastPrice <= 0) {
      return {
        ok: false,
        error:
          'Для входа по диапазону нужна текущая цена инструмента (не удалось получить с биржи).',
      };
    }
    const EPS = 1e-9 * Math.max(1, Math.abs(low), Math.abs(high));
    if (lastPrice >= low - EPS && lastPrice <= high + EPS) {
      void this.appLog.append('info', 'bybit', 'placeSignalOrders: диапазон входа — цена в зоне или на границе, рыночный вход', {
        pair: signal.pair,
        low,
        high,
        lastPrice,
      });
      return { ok: true, effectiveEntries: [], weights: [] };
    }
    const target = lastPrice < low ? low + inset : high - inset;
    const snapped = this.snapPriceToTickNum(target, tickSize);
    void this.appLog.append('info', 'bybit', 'placeSignalOrders: диапазон входа — цена вне зоны, одна лимит/stop цена', {
      pair: signal.pair,
      low,
      high,
      lastPrice,
      target: snapped,
    });
    return { ok: true, effectiveEntries: [snapped], weights: [1] };
  }

  private entryNotionalWeights(entryCount: number): number[] {
    return entryNotionalWeightsUtil(entryCount);
  }

  /**
   * Деление объёма позиции на n TP по шагу qtyStep.
   * Базово делим поровну, а "остаток" шагов отдаём в ближайшие TP (первые уровни),
   * чтобы крупнейшие части закрывались раньше.
   */
  private splitPositionQtyForTps(
    totalQtyBase: number,
    tpCount: number,
    qtyStep: string,
    minQty: string,
  ): string[] {
    return splitPositionQtyForTpsUtil({ totalQtyBase, tpCount, qtyStep, minQty });
  }

  /**
   * Разделяет уже рассчитанный кусок qty на дочерние части (например: TP на каждый entry).
   * Возвращает только положительные части.
   */
  private splitQtyForChildOrders(
    totalQtyBase: number,
    childCount: number,
    qtyStep: string,
    minQty: string,
  ): string[] {
    return splitQtyForChildOrdersUtil({ totalQtyBase, childCount, qtyStep, minQty });
  }

  private buildTpSplitDiagnostics(params: {
    posSize: number;
    requestedLevels: number;
    qtyStep: string;
    minQty: string;
  }): {
    posSizeRounded: string;
    totalUnits: number;
    qtyStepNum: number | null;
    minQtyNum: number | null;
    reasons: string[];
  } {
    return buildTpSplitDiagnosticsUtil(params);
  }

  /**
   * Проверка до подтверждения: нельзя второй раз открыть ту же сторону (long/short) по паре.
   * Long и short по одной паре допускаются. Источник истины — Bybit API по стороне сделки;
   * при «чистой» бирже по этой стороне зависшие ORDERS_PLACED в БД снимаются.
   */
  async wouldDuplicateActivePairDirection(
    pair: string,
    direction: 'long' | 'short',
  ): Promise<boolean> {
    const symbol = normalizeTradingPair(pair);
    const client = await this.getClient();
    if (client) {
      try {
        const busy = await this.hasExchangeExposureForDirection(
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
        // без API — остаёмся на записи БД
      }
    }
    return this.orders.hasActiveSignalForPairAndDirection(pair, direction);
  }

  /**
   * Hedge: по символу две строки позиции (Buy / Sell). Берём ту, что соответствует сигналу.
   * One-way: обычно одна строка с ненулевым size.
   */
  private static pickPositionRowForSignalDirection(
    rows: Array<{
      size?: string;
      side?: string;
      positionIdx?: number;
      stopLoss?: string;
    }>,
    direction: 'long' | 'short',
  ):
    | {
        size?: string;
        side?: string;
        positionIdx?: number;
        stopLoss?: string;
      }
    | undefined {
    const wantBuy = direction === 'long';
    const withSize = rows.filter((r) => {
      const sz = r?.size ? Math.abs(parseFloat(String(r.size))) : 0;
      return sz > 1e-12;
    });
    const matched = withSize.find((r) => {
      const side = String(r.side ?? '').toLowerCase();
      const isBuy = side === 'buy';
      return wantBuy === isBuy;
    });
    if (matched) {
      return matched;
    }
    if (withSize.length === 1) {
      const side = String(withSize[0]?.side ?? '').toLowerCase();
      // Для one-way позиции с известной стороной не допускаем фолбэк на противоположный сигнал.
      if (side === 'buy' || side === 'sell') {
        return undefined;
      }
      return withSize[0];
    }
    return withSize[0];
  }

  /**
   * TP/SL/трейлинг и т.п. — закрывают позицию, не считаются «входом» в противоположную сторону.
   * Bybit часто отдаёт reduceOnly как 1 или true; иногда только stopOrderType.
   */
  private static isReduceOnlyOrClosingOrder(o: {
    reduceOnly?: unknown;
    closeOnTrigger?: unknown;
    stopOrderType?: unknown;
  }): boolean {
    return isReduceOnlyOrClosingOrder(o);
  }

  /**
   * Активность на бирже по символу в заданную сторону (long=Buy, short=Sell).
   * Учитываются ненулевая позиция на этой стороне и открытые не-reduce-only ордера на этой стороне.
   */
  private async hasExchangeExposureForDirection(
    client: RestClientV5,
    symbol: string,
    direction: 'long' | 'short',
  ): Promise<boolean> {
    return this.bybitExposure.hasExchangeExposureForDirection(client, symbol, direction);
  }

  private async getExchangeActiveOrders(
    client: RestClientV5,
    symbol: string,
  ): Promise<LiveExposureOrder[]> {
    return this.bybitExposure.getExchangeActiveOrders(client, symbol);
  }

  private async getExchangePositions(
    client: RestClientV5,
    symbol: string,
  ): Promise<LiveExposurePosition[]> {
    return this.bybitExposure.getExchangePositions(client, symbol);
  }

  private static pickLiveExposurePositionForDirection(
    positions: LiveExposurePosition[],
    direction: 'long' | 'short',
  ): LiveExposurePosition | undefined {
    const wantSide = direction === 'long' ? 'buy' : 'sell';
    const matched = positions.find(
      (row) => String(row.side ?? '').trim().toLowerCase() === wantSide,
    );
    if (matched) {
      return matched;
    }
    if (positions.length === 1) {
      const only = positions[0];
      const side = String(only?.side ?? '').trim().toLowerCase();
      if (side === 'buy' || side === 'sell') {
        return undefined;
      }
      return only;
    }
    return undefined;
  }

  async getLiveExposureSnapshot(): Promise<{
    bybitConnected: boolean;
    items: LiveExposureItem[];
  }> {
    const openSignals = await this.orders.listOpenSignals();
    const client = await this.getClient();
    const bybitConnected = Boolean(client);
    const items: LiveExposureItem[] = [];

    for (const sig of openSignals) {
      const symbol = normalizeTradingPair(sig.pair);
      let activeOrders: LiveExposureOrder[] = [];
      let positions: LiveExposurePosition[] = [];

      if (client) {
        try {
          [activeOrders, positions] = await Promise.all([
            this.getExchangeActiveOrders(client, symbol),
            this.getExchangePositions(client, symbol),
          ]);
        } catch (e) {
          this.logger.warn(
            `getLiveExposureSnapshot ${symbol}: ${formatError(e)}`,
          );
        }
      }

      items.push({
        signalId: sig.id,
        pair: symbol,
        direction: sig.direction,
        status: sig.status,
        source: sig.source ?? null,
        createdAt: sig.createdAt,
        dbOrders: sig.orders.map((o) => ({
          id: o.id,
          orderKind: o.orderKind,
          side: o.side,
          status: o.status,
          price: o.price,
          qty: o.qty,
          bybitOrderId: o.bybitOrderId,
        })),
        exchange: {
          activeOrders,
          positions,
          hasExposure: activeOrders.length > 0 || positions.length > 0,
        },
      });
    }

    const exposedItems = items.filter((item) => item.exchange.hasExposure);
    return { bybitConnected, items: exposedItems };
  }

  async getSignalExecutionDebugSnapshot(
    signalId: string,
  ): Promise<SignalExecutionDebugSnapshot> {
    const signal = await this.orders.getSignalWithOrders(signalId);
    if (!signal) {
      return {
        ok: false,
        signalId,
        bybitConnected: false,
        error: 'Сигнал не найден',
      };
    }

    const symbol = normalizeTradingPair(signal.pair);
    const client = await this.getClient();
    const bybitConnected = Boolean(client);
    const dbOrders = signal.orders.map((o) => ({
      id: o.id,
      orderKind: o.orderKind,
      side: o.side,
      status: o.status,
      price: o.price,
      qty: o.qty,
      bybitOrderId: o.bybitOrderId,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));

    const base: SignalExecutionDebugSnapshot = {
      ok: true,
      signalId: signal.id,
      bybitConnected,
      symbol,
      signal: {
        id: signal.id,
        pair: symbol,
        direction: signal.direction,
        status: signal.status,
        source: signal.source ?? null,
        createdAt: signal.createdAt,
        updatedAt: signal.updatedAt,
      },
      dbOrders,
    };

    if (!client) {
      return base;
    }

    let activeOrders: LiveExposureOrder[] = [];
    let positions: LiveExposurePosition[] = [];
    try {
      [activeOrders, positions] = await Promise.all([
        this.getExchangeActiveOrders(client, symbol),
        this.getExchangePositions(client, symbol),
      ]);
    } catch (e) {
      return {
        ...base,
        exchange: {
          activeOrders: [],
          positions: [],
          bybitOrderStatuses: [],
        },
        error: `Не удалось получить live-снимок биржи: ${formatError(e)}`,
      };
    }

    const bybitOrderStatuses: {
      dbOrderId: string;
      bybitOrderId: string;
      exchangeStatus?: string;
      execQty: number;
      execValue: number;
      execCount: number;
      firstExecAt?: string;
      lastExecAt?: string;
      fetchError?: string;
    }[] = [];

    for (const db of signal.orders) {
      const bybitOrderId = db.bybitOrderId?.trim();
      if (!bybitOrderId) continue;
      try {
        const [exchangeStatus, execSummary] = await Promise.all([
          this.fetchOrderStatusFromExchange(
            client,
            symbol,
            bybitOrderId,
            db.qty ?? undefined,
          ),
          this.getExecutionSummary(client, symbol, bybitOrderId),
        ]);
        bybitOrderStatuses.push({
          dbOrderId: db.id,
          bybitOrderId,
          exchangeStatus,
          execQty: execSummary.execQty,
          execValue: execSummary.execValue,
          execCount: execSummary.execCount,
          firstExecAt: execSummary.firstExecAt,
          lastExecAt: execSummary.lastExecAt,
        });
      } catch (e) {
        bybitOrderStatuses.push({
          dbOrderId: db.id,
          bybitOrderId,
          execQty: 0,
          execValue: 0,
          execCount: 0,
          fetchError: formatError(e),
        });
      }
    }

    return {
      ...base,
      exchange: {
        activeOrders,
        positions,
        bybitOrderStatuses,
      },
    };
  }

  private async getExecutionSummary(
    client: RestClientV5,
    pair: string,
    orderId: string,
  ): Promise<{
    execQty: number;
    execValue: number;
    execCount: number;
    firstExecAt?: string;
    lastExecAt?: string;
  }> {
    const sym = normalizeTradingPair(pair);
    const res = await client.getExecutionList({
      category: 'linear',
      symbol: sym,
      orderId,
      limit: 50,
    });
    if (res.retCode !== 0) {
      return { execQty: 0, execValue: 0, execCount: 0 };
    }

    let execQty = 0;
    let execValue = 0;
    let firstExecAt: number | undefined;
    let lastExecAt: number | undefined;
    let execCount = 0;
    for (const ex of res.result?.list ?? []) {
      execCount += 1;
      execQty += parseFloat(String(ex.execQty ?? 0)) || 0;
      execValue += parseFloat(String(ex.execValue ?? 0)) || 0;
      const ms = Number(ex.execTime);
      if (Number.isFinite(ms) && ms > 0) {
        if (firstExecAt === undefined || ms < firstExecAt) {
          firstExecAt = ms;
        }
        if (lastExecAt === undefined || ms > lastExecAt) {
          lastExecAt = ms;
        }
      }
    }
    return {
      execQty,
      execValue,
      execCount,
      firstExecAt: firstExecAt ? new Date(firstExecAt).toISOString() : undefined,
      lastExecAt: lastExecAt ? new Date(lastExecAt).toISOString() : undefined,
    };
  }

  private async flattenLinearSymbolOnExchange(
    client: RestClientV5,
    symbol: string,
  ) {
    return this.bybitPositionClose.flattenLinearSymbolOnExchange(client, symbol, {
      appLog: this.appLog,
      getExchangePositions: (c, s) => this.getExchangePositions(c, s),
      getLotStep: (c, s) => this.getLotStep(c, s),
      formatQtyToStep: (qty, qtyStep) => this.formatQtyToStep(qty, qtyStep),
      waitForSymbolToBeFlat: (c, s, timeoutMs, pollMs) =>
        this.waitForSymbolToBeFlat(c, s, timeoutMs, pollMs),
    });
  }

  /**
   * Перед удалением сделки в статусе ORDERS_PLACED: отмена ордеров и закрытие позиции на Bybit.
   */
  async cleanupExchangeBeforeDeletingPlacedSignal(
    signalId: string,
  ): Promise<CloseSignalResult> {
    const signal = await this.orders.getSignalWithOrders(signalId);
    if (!signal) {
      return { ok: false, error: 'Сигнал не найден' };
    }

    const symbol = normalizeTradingPair(signal.pair);
    const client = await this.getClient();
    if (!client) {
      return {
        ok: false,
        signalId,
        symbol,
        error:
          'Нет подключенных ключей Bybit. Настройте BYBIT_API_KEY/BYBIT_API_SECRET.',
      };
    }

    const flatResult = await this.flattenLinearSymbolOnExchange(client, symbol);
    if (!flatResult.ok) {
      if (flatResult.pendingExchange) {
        await this.orders.createSignalEvent(
          signalId,
          'BYBIT_TRADE_DELETE_CLEANUP_PENDING',
          {
            symbol,
            activeOrders: flatResult.activeOrders,
            positions: flatResult.positions,
            cancelledOrders: flatResult.cancelledOrders,
            closedPositions: flatResult.closedPositions,
          },
        );
        void this.appLog.append('warn', 'bybit', 'trade delete: exchange cleanup pending', {
          signalId,
          symbol,
          activeOrders: flatResult.activeOrders,
          positions: flatResult.positions,
        });
      } else {
        const errParts = flatResult.details
          .split(' | ')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        await this.orders.createSignalEvent(
          signalId,
          'BYBIT_TRADE_DELETE_CLEANUP_FAILED',
          {
            symbol,
            errors: errParts.length > 0 ? errParts : [flatResult.details],
            cancelledOrders: flatResult.cancelledOrders,
            closedPositions: flatResult.closedPositions,
          },
        );
        void this.appLog.append('error', 'bybit', 'trade delete: exchange cleanup failed', {
          signalId,
          symbol,
          details: flatResult.details,
        });
      }
      return {
        ok: false,
        signalId,
        symbol,
        cancelledOrders: flatResult.cancelledOrders,
        closedPositions: flatResult.closedPositions,
        error: flatResult.error,
        details: flatResult.details,
      };
    }

    for (const ord of signal.orders) {
      if (BybitService.isFilledOrderStatus(ord.status)) {
        continue;
      }
      await this.orders.updateOrder(ord.id, {
        status: 'CANCELLED_MANUAL',
      });
    }

    await this.orders.createSignalEvent(signalId, 'BYBIT_TRADE_DELETE_CLEANUP_SUCCESS', {
      symbol,
      cancelledOrders: flatResult.cancelledOrders,
      closedPositions: flatResult.closedPositions,
      deletedAt: new Date().toISOString(),
    });
    void this.appLog.append('info', 'bybit', 'trade delete: exchange cleanup ok', {
      signalId,
      symbol,
      cancelledOrders: flatResult.cancelledOrders,
      closedPositions: flatResult.closedPositions,
    });
    await this.notifyApiTradeCancelled(signal, 'Удаление сделки');

    return {
      ok: true,
      signalId,
      symbol,
      cancelledOrders: flatResult.cancelledOrders,
      closedPositions: flatResult.closedPositions,
    };
  }

  async closeSignalManually(signalId: string): Promise<CloseSignalResult> {
    return this.bybitPositionClose.closeSignalManually(signalId, {
      normalizeTradingPair,
      orders: this.orders,
      getClient: () => this.getClient(),
      flattenLinearSymbolOnExchange: (client, symbol) =>
        this.flattenLinearSymbolOnExchange(client, symbol),
      appLog: this.appLog,
      isFilledOrderStatus: (status) => BybitService.isFilledOrderStatus(status),
      notifyApiTradeCancelled: (signal, reason) => this.notifyApiTradeCancelled(signal, reason),
    });
  }

  private async notifyApiTradeCancelled(
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
    await this.bybitNotify.notifyApiTradeCancelled(signal, reason);
  }

  private async notifyApiTradeLiquidation(params: {
    signalId: string;
    pair: string;
    direction: string;
    leverage: number;
    source: string | null;
    realizedPnl?: number | null;
  }): Promise<void> {
    await this.bybitNotify.notifyApiTradeLiquidation(params);
  }

  /** Уведомление при авто‑закрытии ORDERS_PLACED после синхронизации с «чистой» биржей (без ручного closeSignalManually). */
  async processTradeCancelledNotificationJob(params: {
    signalIds: string[];
    reason: string;
  }): Promise<void> {
    await this.bybitNotify.processTradeCancelledNotificationJob(params);
  }

  private async notifyStaleReconcileTradeCancelled(
    signalIds: string[],
    reason: string,
  ): Promise<void> {
    await this.bybitNotify.notifyStaleReconcileTradeCancelled(signalIds, reason);
  }

  private async waitForSymbolToBeFlat(
    client: RestClientV5,
    symbol: string,
    timeoutMs = 10_000,
    pollMs = 1_000,
  ): Promise<{ ok: true } | { ok: false; activeOrders: number; positions: number }> {
    const deadline = Date.now() + timeoutMs;
    let lastActiveOrders = 0;
    let lastPositions = 0;

    while (Date.now() <= deadline) {
      const [activeOrders, positions] = await Promise.all([
        this.getExchangeActiveOrders(client, symbol),
        this.getExchangePositions(client, symbol),
      ]);
      lastActiveOrders = activeOrders.length;
      lastPositions = positions.length;
      if (lastActiveOrders === 0 && lastPositions === 0) {
        return { ok: true };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return {
      ok: false,
      activeOrders: lastActiveOrders,
      positions: lastPositions,
    };
  }

  async placeSignalOrders(
    signal: SignalDto,
    rawMessage: string | undefined,
    origin?: { chatId?: string; messageId?: string; signalExternalId?: string },
  ): Promise<PlaceOrdersResult> {
    return this.bybitSignalPlacement.placeSignalOrders(signal, rawMessage, origin, {
      settings: this.settings,
      appLog: this.appLog,
      orders: this.orders,
      placementLocks: this.placementLocks,
      getClient: () => this.getClient(),
      applySourceMartingaleSizing: (s: SignalDto) => this.applySourceMartingaleSizing(s),
      applyForcedLeverage: (s: SignalDto, o?: { chatId?: string; messageId?: string; signalExternalId?: string }) =>
        this.applyForcedLeverage(s, o),
      hasExchangeExposureForDirection: (client: RestClientV5, symbol: string, direction: 'long' | 'short') =>
        this.hasExchangeExposureForDirection(client, symbol, direction),
      clearImmediateStaleDbBlockerIfExchangeFlat: (
        pair: string,
        direction: 'long' | 'short',
        client: RestClientV5,
        reason: string,
      ) => this.clearImmediateStaleDbBlockerIfExchangeFlat(pair, direction, client, reason),
      buildPlacementLockKey: (pair: string, direction: 'long' | 'short') =>
        this.buildPlacementLockKey(pair, direction),
      getLastPrice: (client: RestClientV5, symbol: string) => this.getLastPrice(client, symbol),
      validateSignalLevels: (s: SignalDto, lastPrice?: number) => this.validateSignalLevels(s, lastPrice),
      getUsdtBalanceDetails: (client: RestClientV5) => this.getUsdtBalanceDetails(client),
      getLinearInstrumentFilters: (client: RestClientV5, symbol: string) =>
        this.getLinearInstrumentFilters(client, symbol),
      applyEntryRangeResolution: (s: SignalDto, lastPrice: number | undefined, tickSize: string) =>
        this.applyEntryRangeResolution(s, lastPrice, tickSize),
      resolveBumpToMinExchangeLot: (chatId?: string) => this.resolveBumpToMinExchangeLot(chatId),
      validateLeveragedNotionalVsMinQty: (input: any) => this.validateLeveragedNotionalVsMinQty(input),
      resolveEntryPositionIdx: (client: RestClientV5, symbol: string, side: 'Buy' | 'Sell') =>
        this.resolveEntryPositionIdx(client, symbol, side),
      roundQty: (qtyNum: number, qtyStep: string, minQty: string) => this.roundQty(qtyNum, qtyStep, minQty),
      snapPriceToTickNum: (price: number, tickSize: string) => this.snapPriceToTickNum(price, tickSize),
      isInsufficientBalanceError: (msg: string | null | undefined) =>
        BybitService.isInsufficientBalanceError(msg),
    });
  }

  /** Bybit отдаёт статус с фиксированным регистром; на всякий случай нормализуем. */
  private static isFilledOrderStatus(status: string | null | undefined): boolean {
    return (status ?? '').trim().toLowerCase() === 'filled';
  }

  /**
   * Распознаём ошибки нехватки доступной маржи/баланса.
   * Пример Bybit: "ab not enough for new order".
   */
  private static isInsufficientBalanceError(msg: string | null | undefined): boolean {
    const t = (msg ?? '').trim().toLowerCase();
    return (
      t.includes('ab not enough for new order') ||
      t.includes('insufficient') ||
      (t.includes('not enough') && t.includes('order'))
    );
  }

  /** NEW/New/Created и т.п. считаем ещё живыми ордерами. */
  private static isOpenOrderStatus(status: string | null | undefined): boolean {
    const normalized = (status ?? '').trim().toLowerCase();
    return Array.from(BYBIT_OPEN_ORDER_STATUSES).some(
      (s) => s.toLowerCase() === normalized,
    );
  }

  /** Пока есть живые ENTRY/DCA, TP ставить рано: позиция ещё добирается. */
  private hasOpenEntryOrders(
    orders: {
      orderKind: string;
      status: string | null;
    }[],
  ): boolean {
    return orders.some((o) => {
      if (o.orderKind !== 'ENTRY' && o.orderKind !== 'DCA') {
        return false;
      }
      return BybitService.isOpenOrderStatus(o.status);
    });
  }

  /** Есть ли уже исполненный вход (ENTRY/DCA). PartiallyFilled считаем достаточным для TP/SL по текущему объёму. */
  private hasFilledEntryOrders(
    orders: {
      orderKind: string;
      status: string | null;
    }[],
  ): boolean {
    return orders.some((o) => {
      if (o.orderKind !== 'ENTRY' && o.orderKind !== 'DCA') {
        return false;
      }
      const s = (o.status ?? '').trim().toLowerCase();
      return s === 'filled' || s === 'partiallyfilled';
    });
  }

  /**
   * Наличие активных TP-лимиток на бирже.
   * Важно: FAILED/Cancelled TP в БД не должны блокировать повторную постановку.
   */
  private hasLiveTpOrders(
    orders: {
      orderKind: string;
      status: string | null;
    }[],
  ): boolean {
    return orders.some((o) => {
      if (o.orderKind !== 'TP') {
        return false;
      }
      return BybitService.isOpenOrderStatus(o.status);
    });
  }

  /**
   * SL на всю позицию (UTA). Без `tpslMode` Bybit V5 часто отклоняет запрос.
   * При ok=false в failReason — текст ответа API (retCode/retMsg), предпроверка или исключение.
   */
  private async applyPositionStopLossFull(
    client: RestClientV5,
    symbol: string,
    stopLoss: number,
    context: string,
    positionIdx: 0 | 1 | 2 = 0,
  ): Promise<{ ok: boolean; failReason?: string }> {
    return this.bybitTpSl.applyPositionStopLossFull(
      client,
      symbol,
      stopLoss,
      context,
      positionIdx,
    );
  }

  /** Есть ли на строке позиции ненулевой SL. */
  private static positionHasStopLoss(row: { stopLoss?: string } | undefined): boolean {
    return positionHasStopLossUtil(row);
  }

  /**
   * Если история не отдаёт статус, смотрим исполнения: набрался ли объём по ордеру.
   */
  private async inferFilledFromExecutions(
    client: RestClientV5,
    sym: string,
    orderId: string,
    expectedQty: number,
  ): Promise<boolean> {
    if (expectedQty <= 1e-12) {
      return false;
    }
    try {
      const res = await client.getExecutionList({
        category: 'linear',
        symbol: sym,
        orderId,
        limit: 50,
      });
      if (res.retCode !== 0) {
        return false;
      }
      let cum = 0;
      for (const ex of res.result?.list ?? []) {
        cum += parseFloat(String(ex.execQty ?? 0));
      }
      return cum >= expectedQty * 0.999;
    } catch {
      return false;
    }
  }

  /**
   * Актуальный статус ордера: realtime → history (UTA: settleCoin + orderFilter).
   * Если пусто — пробуем исполнения по orderId (часто так виден полный fill при задержке history).
   */
  private async fetchOrderStatusFromExchange(
    client: RestClientV5,
    pair: string,
    orderId: string,
    expectedQty?: number,
  ): Promise<string | undefined> {
    const sym = normalizeTradingPair(pair);
    const base = {
      category: 'linear' as const,
      symbol: sym,
      settleCoin: 'USDT' as const,
      orderFilter: 'Order' as const,
    };
    try {
      const active = await client.getActiveOrders({
        ...base,
        orderId,
        // Ищем ордер среди реально активных, иначе New/Untriggered пропадают из snapshot/poll.
        openOnly: 0,
        limit: 1,
      });
      if (active.retCode === 0 && (active.result?.list?.length ?? 0) > 0) {
        return active.result!.list![0]!.orderStatus;
      }
    } catch (e) {
      this.logger.debug(`getActiveOrders ${orderId}: ${formatError(e)}`);
    }
    try {
      const hist = await client.getHistoricOrders({
        ...base,
        orderId,
        limit: 1,
      });
      if (hist.retCode === 0 && (hist.result?.list?.length ?? 0) > 0) {
        return hist.result!.list![0]!.orderStatus;
      }
    } catch (e) {
      this.logger.debug(`getHistoricOrders ${orderId}: ${formatError(e)}`);
    }
    try {
      const histScan = await client.getHistoricOrders({
        ...base,
        limit: 50,
      });
      if (histScan.retCode === 0) {
        const row = histScan.result?.list?.find((o) => o.orderId === orderId);
        if (row?.orderStatus) {
          return row.orderStatus;
        }
        if (row) {
          const leaves = parseFloat(String(row.leavesQty ?? '1'));
          const cum = parseFloat(String(row.cumExecQty ?? '0'));
          if (leaves <= 1e-12 && cum > 0) {
            return 'Filled';
          }
        }
      }
    } catch (e) {
      this.logger.debug(`getHistoricOrders scan ${orderId}: ${formatError(e)}`);
    }
    if (expectedQty !== undefined && expectedQty > 0) {
      const ok = await this.inferFilledFromExecutions(
        client,
        sym,
        orderId,
        expectedQty,
      );
      if (ok) {
        return 'Filled';
      }
    }
    return undefined;
  }

  /**
   * Несколько TP: пока лимитки входов не исполнены — TP/SL **не** вешаются на ордер (так задумано).
   * Как только появляется позиция — выставляем SL на всю позицию (через poll).
   * После исполнения **всех** входов — SL (ещё раз, безопасно) + reduce-only TP лимитки.
   */
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
      pickPositionRowForSignalDirection: BybitService.pickPositionRowForSignalDirection,
    });
  }

  /** Один warn на пару (kind, key, value) за процесс; при переполнении множество сбрасывается. */
  private takeSourceTpMapSkipLogSlot(
    kind: 'start' | 'range',
    entryKey: string,
    val: unknown,
  ): boolean {
    const sig = `${kind}:${entryKey}:${JSON.stringify(val)}`;
    if (this.sourceTpMapSkipLogged.has(sig)) {
      return false;
    }
    if (this.sourceTpMapSkipLogged.size >= BYBIT_SOURCE_MAP_SKIP_LOG_CAP) {
      this.sourceTpMapSkipLogged.clear();
    }
    this.sourceTpMapSkipLogged.add(sig);
    return true;
  }

  /**
   * После исполнения TP подряд с TP1 подтягивает SL.
   *
   * `TP_SL_STEP_START` — с какого номера TP начинать (до этого SL не двигается); первый шаг — безубыток.
   * `TP_SL_STEP_RANGE` (1..5), опционально: после старта SL ставится на TP с индексом `filledCount − range − 1`
   * в отсортированном списке TP; при `filledCount == start` всегда BE. Если настройка пуста — range = start
   * (как раньше: tp1 → диапазон 1, tp2 → 2).
   *
   * Переопределение по источнику: `SOURCE_TP_SL_STEP_START`, `SOURCE_TP_SL_STEP_RANGE`.
   * Устаревшее `TP_SL_STEP_ENABLED=true` ≡ tp2.
   * `tpSlStep` в БД — последний применённый `targetStep` = `filledCount − start` (−1 = ни разу).
   */
  private async resolveTpSlLadderConfigForSignal(
    source: string | null | undefined,
  ): Promise<{ mode: TpSlStepStartMode; startNum: number; rangeNum: number } | null> {
    return this.bybitTpSl.resolveTpSlLadderConfigForSignal(source, {
      settings: this.settings,
      getCabinetSourceByTitle: (title: string) => this.getCabinetSourceByTitle(title),
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
    await this.bybitTpSl.stepStopLossIfTpFilled(client, fresh, {
      settings: this.settings,
      prisma: this.prisma,
      orders: this.orders,
      getCabinetSourceByTitle: (title: string) => this.getCabinetSourceByTitle(title),
      getLinearInstrumentFilters: (c: RestClientV5, s: string) => this.getLinearInstrumentFilters(c, s),
      formatPriceToTick: (price: number, tickSize: string) => this.formatPriceToTick(price, tickSize),
      snapPriceToTickNum: (price: number, tickSize: string) => this.snapPriceToTickNum(price, tickSize),
      isFilledOrderStatus: (status: string | null | undefined) => BybitService.isFilledOrderStatus(status),
    });
  }

  /**
   * Как только появляется позиция — синхронизируем TP/SL под её текущий размер.
   * Если объём позиции вырос после частичных входов, довыставляем недостающие TP
   * только на непокрытую часть.
   */
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

  /**
   * Closed PnL у TP/SL одной позиции может иметь разные orderId
   * (например, SL из setTradingStop). Поэтому:
   * 1) всегда берём строки с нашими orderId;
   * 2) если у нас уже есть совпадения по orderId — добираем строки по тому же символу
   *    после старта сигнала (буфер -60с на задержки времени от биржи).
   */
  private sumClosedPnlForSignal(
    rows: unknown[],
    ourIds: Set<string>,
    direction: string,
    signalCreatedAt: Date,
    signalClosedAt?: Date | null,
  ): {
    totalPnl: number;
    grossPnl: number;
    hadParsedPnl: boolean;
    openFee: number;
    closeFee: number;
    execFee: number;
    totalFee: number;
  } {
    return this.bybitPnl.sumClosedPnlForSignal(
      rows,
      ourIds,
      direction,
      signalCreatedAt,
      signalClosedAt,
    );
  }

  private async fetchClosedPnlRowsForSymbol(
    client: RestClientV5,
    symbol: string,
    rangeStartMs: number,
    rangeEndMs: number,
  ): Promise<unknown[]> {
    return this.bybitPnl.fetchClosedPnlRowsForSymbol(
      client,
      symbol,
      rangeStartMs,
      rangeEndMs,
    );
  }

  private buildClosedPnlWindow(
    signalCreatedAt: Date,
    signalClosedAt?: Date | null,
  ): { startTime: number; endTime: number } {
    return this.bybitPnl.buildClosedPnlWindow(signalCreatedAt, signalClosedAt);
  }

  /**
   * Fallback оценка PnL по исполнениям (execution list), когда ClosedPnL
   * не удаётся связать по orderId (например, SL с отдельным id из setTradingStop).
   */
  private async estimateClosedPnlFromExecutions(params: {
    client: RestClientV5;
    symbol: string;
    direction: string;
    createdAt: Date;
    closedAt?: Date | null;
  }): Promise<{ netPnl: number; grossPnl: number; totalFees: number } | undefined> {
    return this.bybitPnl.estimateClosedPnlFromExecutions(params);
  }

  private static isLiquidationExecutionRow(
    row: Record<string, unknown>,
  ): boolean {
    return isLiquidationExecutionRowUtil(row);
  }

  private static isClosedPnlLiquidationRow(row: unknown): boolean {
    return isClosedPnlLiquidationRowUtil(row);
  }

  private async detectLiquidationByExecutions(params: {
    client: RestClientV5;
    symbol: string;
    direction: 'long' | 'short';
    createdAt: Date;
    closedAt?: Date | null;
    trackedOrderIds: Set<string>;
  }): Promise<boolean> {
    return this.bybitPnl.detectLiquidationByExecutions(params);
  }

  async getTradePnlBreakdown(signalId: string): Promise<TradePnlBreakdownResult> {
    return this.bybitPnl.getTradePnlBreakdown({
      signalId,
      getSignalWithOrders: (id) => this.orders.getSignalWithOrders(id),
      getClient: () => this.getClient(),
    });
  }

  private async applyForcedLeverage(
    signal: SignalDto,
    origin?: { chatId?: string },
  ): Promise<SignalDto> {
    let chatForced: number | null | undefined;
    const cid = origin?.chatId?.trim();
    if (cid) {
      const cabinetId = this.currentCabinetId();
      if (cabinetId) {
        const scoped = await this.prisma.cabinetTelegramSource.findUnique({
          where: { cabinetId_chatId: { cabinetId, chatId: cid } },
          select: { forcedLeverage: true },
        });
        if (scoped?.forcedLeverage != null) {
          chatForced = scoped.forcedLeverage;
        }
      }
      if (chatForced == null) {
        const row = await this.prisma.tgUserbotChat.findUnique({
          where: { chatId: cid },
          select: { forcedLeverage: true },
        });
        chatForced = row?.forcedLeverage ?? undefined;
      }
    }
    const rawGlobal = await this.settings.get('FORCED_LEVERAGE');
    const src = String(signal.source ?? '').trim();
    const resolved = resolveForcedLeverageWithChatOverride(chatForced, rawGlobal);
    if (resolved == null) {
      return signal;
    }
    if (resolved === signal.leverage) {
      return signal;
    }
    void this.appLog.append('info', 'bybit', 'принудительное плечо', {
      pair: signal.pair,
      source: src || null,
      sourceChatId: cid ?? null,
      leverageBefore: signal.leverage,
      leverageAfter: resolved,
    });
    return { ...signal, leverage: resolved };
  }

  private async getCabinetSourceByTitle(source: string): Promise<{
    tpSlStepStart: string | null;
    tpSlStepRange: number | null;
    martingaleMultiplier: number | null;
  } | null> {
    const cabinetId = this.currentCabinetId();
    const title = source.trim();
    if (!cabinetId || !title) {
      return null;
    }
    const chat = await this.prisma.tgUserbotChat.findFirst({
      where: { title: { equals: title, mode: 'insensitive' } },
      select: { chatId: true },
    });
    if (!chat?.chatId) {
      return null;
    }
    return this.prisma.cabinetTelegramSource.findUnique({
      where: {
        cabinetId_chatId: {
          cabinetId,
          chatId: chat.chatId,
        },
      },
      select: {
        tpSlStepStart: true,
        tpSlStepRange: true,
        martingaleMultiplier: true,
      },
    });
  }

  private async applySourceMartingaleSizing(signal: SignalDto): Promise<SignalDto> {
    const sourceRaw = String(signal.source ?? '').trim();
    if (!sourceRaw) {
      return signal;
    }

    const [rawMap, rawDefault, scopedSource] = await Promise.all([
      this.settings.get('SOURCE_MARTINGALE_MULTIPLIERS'),
      this.settings.get('SOURCE_MARTINGALE_DEFAULT_MULTIPLIER'),
      this.getCabinetSourceByTitle(sourceRaw),
    ]);
    const bySource = parseSourceMultiplierMap(rawMap);
    const defaultMultiplierParsed = Number(rawDefault);
    const defaultMultiplier =
      Number.isFinite(defaultMultiplierParsed) && defaultMultiplierParsed > 1
        ? defaultMultiplierParsed
        : undefined;
    const multiplier =
      (scopedSource?.martingaleMultiplier != null && scopedSource.martingaleMultiplier > 1
        ? scopedSource.martingaleMultiplier
        : undefined) ??
      bySource.get(sourceRaw.toLowerCase()) ??
      defaultMultiplier;
    if (!multiplier || !Number.isFinite(multiplier) || multiplier <= 1) {
      return signal;
    }

    const prev = await this.orders.getLatestClosedSignalBySource(sourceRaw);
    if (!prev) {
      return signal;
    }
    const isLoss =
      prev.status === 'CLOSED_LOSS' ||
      (typeof prev.realizedPnl === 'number' && prev.realizedPnl < 0);
    if (!isLoss) {
      return signal;
    }

    const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
    const next = { ...signal };
    if (next.orderUsd > 0) {
      next.orderUsd = round(next.orderUsd * multiplier);
    } else if (next.capitalPercent > 0) {
      next.capitalPercent = Math.min(100_000, round(next.capitalPercent * multiplier));
    }

    void this.appLog.append('info', 'bybit', 'martingale applied by source', {
      source: sourceRaw,
      multiplier,
      prevSignalId: prev.id,
      prevStatus: prev.status,
      prevRealizedPnl: prev.realizedPnl,
      orderUsdBefore: signal.orderUsd,
      orderUsdAfter: next.orderUsd,
      capitalPercentBefore: signal.capitalPercent,
      capitalPercentAfter: next.capitalPercent,
    });

    return next;
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
      getClient: () => this.getClient(),
      buildClosedPnlWindow: (signalCreatedAt: Date, signalClosedAt?: Date | null) =>
        this.buildClosedPnlWindow(signalCreatedAt, signalClosedAt),
      fetchClosedPnlRowsForSymbol: (
        client: RestClientV5,
        symbol: string,
        startTime: number,
        endTime: number,
      ) => this.fetchClosedPnlRowsForSymbol(client, symbol, startTime, endTime),
      sumClosedPnlForSignal: (
        rows: unknown[],
        ourIds: Set<string>,
        direction: string,
        signalCreatedAt: Date,
        signalClosedAt?: Date | null,
      ) => this.sumClosedPnlForSignal(rows, ourIds, direction, signalCreatedAt, signalClosedAt),
      estimateClosedPnlFromExecutions: (recalcParams) =>
        this.estimateClosedPnlFromExecutions(recalcParams),
    });
  }

  async pollOpenOrders(): Promise<void> {
    await this.bybitOrderLifecyclePoll.pollOpenOrders({
      getClient: () => this.getClient(),
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
      ) => this.hasExchangeExposureForDirection(client, symbol, direction),
      notifyStaleReconcileTradeCancelled: (signalIds: string[], reason: string) =>
        this.notifyStaleReconcileTradeCancelled(signalIds, reason),
      fetchOrderStatusFromExchange: (
        client: RestClientV5,
        pair: string,
        orderId: string,
        expectedQty?: number,
      ) => this.fetchOrderStatusFromExchange(client, pair, orderId, expectedQty),
      isFilledOrderStatus: (status: string | null | undefined) =>
        BybitService.isFilledOrderStatus(status),
      ensureStopLossForMultiTpOpenPosition: (client: RestClientV5, fresh: any) =>
        this.ensureStopLossForMultiTpOpenPosition(client, fresh),
      placeTpSplitIfNeeded: (client: RestClientV5, fresh: any) =>
        this.placeTpSplitIfNeeded(client, fresh),
      stepStopLossIfTpFilled: (client: RestClientV5, fresh: any) =>
        this.stepStopLossIfTpFilled(client, fresh),
      finalizeSignalCloseIfNeeded: (client: RestClientV5, fresh: any) =>
        this.finalizeSignalCloseIfNeeded(client, fresh),
    });
  }

  private async finalizeSignalCloseIfNeeded(
    client: RestClientV5,
    fresh: any,
  ): Promise<void> {
    const symNorm = normalizeTradingPair(fresh.pair);
    const livePositions = await this.getExchangePositions(client, symNorm);
    const mainPosition = BybitService.pickLiveExposurePositionForDirection(
      livePositions,
      fresh.direction as 'long' | 'short',
    );
    const posSize = mainPosition ? Math.abs(mainPosition.size) : 0;
    const hadFill = fresh.orders.some((o: any) =>
      BybitService.isFilledOrderStatus(o.status),
    );
    if (!(hadFill && posSize === 0 && fresh.status === 'ORDERS_PLACED')) {
      return;
    }

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
        .map((o: any) => (o.bybitOrderId ? String(o.bybitOrderId) : ''))
        .filter((id: string): id is string => id.length > 0),
    );
    const liquidationLeverage = Number.isFinite(fresh.leverage)
      ? Math.max(1, Math.round(fresh.leverage))
      : null;
    const requestWindow = this.buildClosedPnlWindow(fresh.createdAt, new Date());
    const rows = await this.fetchClosedPnlRowsForSymbol(
      client,
      symNorm,
      requestWindow.startTime,
      requestWindow.endTime,
    );
    const isLiquidationByClosedPnl = rows.some((row) =>
      BybitService.isClosedPnlLiquidationRow(row),
    );
    const isLiquidationByExecutions = await this.detectLiquidationByExecutions({
      client,
      symbol: symNorm,
      direction: fresh.direction as 'long' | 'short',
      createdAt: fresh.createdAt,
      closedAt: new Date(),
      trackedOrderIds: ourIds,
    }).catch(() => false);
    const isLiquidation = isLiquidationByClosedPnl || isLiquidationByExecutions;
    const { totalPnl, hadParsedPnl } = this.sumClosedPnlForSignal(
      rows,
      ourIds,
      fresh.direction,
      fresh.createdAt,
    );
    if (hadParsedPnl) {
      const nextStatus = totalPnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS';
      const liquidationData =
        isLiquidation && nextStatus === 'CLOSED_LOSS'
          ? { liquidation: true, liquidationLeverage }
          : { liquidation: false, liquidationLeverage: null };
      await this.orders.updateSignalStatus(fresh.id, {
        status: nextStatus,
        realizedPnl: totalPnl,
        closedAt: new Date(),
        ...liquidationData,
      });
      if (liquidationData.liquidation) {
        await this.notifyApiTradeLiquidation({
          signalId: fresh.id,
          pair: symNorm,
          direction: fresh.direction,
          leverage: liquidationLeverage ?? fresh.leverage,
          source: fresh.source ?? null,
          realizedPnl: totalPnl,
        });
      }
      return;
    }

    if (ourIds.size === 0) {
      return;
    }

    const sibling = await this.orders.findOlderClosedSiblingAfterNewerCreated(
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
        liquidation: false,
        liquidationLeverage: null,
      });
      void this.appLog.append(
        'info',
        'bybit',
        'poll: дубликат сигнала без orderId в closed PnL — CLOSED_MIXED',
        { signalId: fresh.id, pair: symNorm, siblingId: sibling.id },
      );
      return;
    }

    if (this.hasOpenEntryOrders(fresh.orders)) {
      return;
    }
    const estimated = await this.estimateClosedPnlFromExecutions({
      client,
      symbol: symNorm,
      direction: fresh.direction,
      createdAt: fresh.createdAt,
      closedAt: new Date(),
    });
    if (estimated !== undefined) {
      const nextStatus =
        estimated.netPnl > 0
          ? 'CLOSED_WIN'
          : estimated.netPnl < 0
            ? 'CLOSED_LOSS'
            : 'CLOSED_MIXED';
      const liquidationData =
        isLiquidation && nextStatus === 'CLOSED_LOSS'
          ? { liquidation: true, liquidationLeverage }
          : { liquidation: false, liquidationLeverage: null };
      await this.orders.updateSignalStatus(fresh.id, {
        status: nextStatus,
        realizedPnl: estimated.netPnl,
        closedAt: new Date(),
        ...liquidationData,
      });
      if (liquidationData.liquidation) {
        await this.notifyApiTradeLiquidation({
          signalId: fresh.id,
          pair: symNorm,
          direction: fresh.direction,
          leverage: liquidationLeverage ?? fresh.leverage,
          source: fresh.source ?? null,
          realizedPnl: estimated.netPnl,
        });
      }
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
      return;
    }

    await this.orders.updateSignalStatus(fresh.id, {
      status: 'CLOSED_MIXED',
      realizedPnl: null,
      closedAt: new Date(),
      liquidation: false,
      liquidationLeverage: null,
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
      const busy = await this.hasExchangeExposureForDirection(client, symbol, direction);
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
      void this.notifyStaleReconcileTradeCancelled(
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
