import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { formatError } from '../../common/format-error';
import { KeyedMutex } from '../../common/keyed-mutex';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { OrdersService } from '../orders/orders.service';
import { SettingsService } from '../settings/settings.service';
import { TelegramService } from '../telegram/telegram.service';

import { BybitClientService } from './bybit-client.service';
import { BybitExposureService } from './bybit-exposure.service';
import { BybitMarketService } from './bybit-market.service';
import type { PlaceOrdersResult } from './bybit.types';
import {
  isFilledOrderStatus,
  isInsufficientBalanceError,
  isOpenOrderStatus,
  pickPositionRowForSignalDirection,
  positionHasStopLoss,
} from './bybit-order-helpers';
import {
  floorQtyToStepUnits,
  formatPriceToTick,
  formatQtyToStep,
  roundQty,
  snapPriceToTickNum,
} from './bybit-qty-price.util';

@Injectable()
export class BybitPlacementService {
  private readonly logger = new Logger(BybitPlacementService.name);
  private readonly placementLock = new KeyedMutex();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegram: TelegramService,
    private readonly appLog: AppLogService,
    private readonly bybitClient: BybitClientService,
    private readonly market: BybitMarketService,
    private readonly exposure: BybitExposureService,
  ) {}

  private async resolveBumpToMinExchangeLot(
    chatId?: string,
    workspaceId?: string | null,
  ): Promise<boolean> {
    const trimmed = chatId?.trim();
    if (trimmed) {
      const row = await this.prisma.tgUserbotChat.findUnique({
        where: { chatId: trimmed },
        select: { minLotBump: true },
      });
      if (row?.minLotBump != null) {
        return row.minLotBump;
      }
    }
    const raw = await this.settings.get('BUMP_TO_MIN_EXCHANGE_LOT', workspaceId);
    return raw === 'true' || raw === '1';
  }


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

    if (signal.direction === 'long') {
      if (!(sl < minEntry)) {
        return `Некорректный SL для LONG: SL (${sl}) должен быть ниже входа (${minEntry}).`;
      }
      if (tps.some((tp) => tp <= minEntry)) {
        return `Некорректный TP для LONG: TP должен быть выше входа (${minEntry}).`;
      }
    } else {
      if (!(sl > maxEntry)) {
        return `Некорректный SL для SHORT: SL (${sl}) должен быть выше входа (${maxEntry}).`;
      }
      if (tps.some((tp) => tp >= maxEntry)) {
        return `Некорректный TP для SHORT: TP должен быть ниже входа (${maxEntry}).`;
      }
    }
    return undefined;
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
    if (!Number.isFinite(W) || W <= 0) {
      return {
        ok: false,
        error: 'Некорректный диапазон входа: границы совпадают или невалидны.',
      };
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
    const snapped = snapPriceToTickNum(target, tickSize);
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
    const n = entryCount;
    if (n <= 0) return [];
    if (n === 1) return [1];
    const first = 0.5;
    const restEach = (1 - first) / (n - 1);
    return Array.from({ length: n }, (_, i) => (i === 0 ? first : restEach));
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
    const stepNum = parseFloat(qtyStep);
    const min = parseFloat(minQty);
    if (
      tpCount <= 0 ||
      totalQtyBase <= 0 ||
      !Number.isFinite(stepNum) ||
      stepNum <= 0
    ) {
      return [];
    }
    const totalUnits = floorQtyToStepUnits(totalQtyBase, stepNum);
    const totalFloored = totalUnits * stepNum;
    if (!Number.isFinite(totalFloored) || totalFloored < min) {
      return [];
    }
    const baseUnits = Math.floor(totalUnits / tpCount);
    const baseQty = baseUnits * stepNum;
    if (!Number.isFinite(baseQty) || baseQty < min) {
      return [];
    }
    const outUnits = Array.from({ length: tpCount }, () => baseUnits);
    let remainderUnits = totalUnits - baseUnits * tpCount;
    // Остаток уходит в ближайшие TP (индексы с начала списка).
    for (let i = 0; i < tpCount && remainderUnits > 0; i++) {
      outUnits[i] = (outUnits[i] ?? 0) + 1;
      remainderUnits -= 1;
    }
    return outUnits.map((u) => formatQtyToStep(u * stepNum, qtyStep));
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
    if (childCount <= 1) {
      const one = formatQtyToStep(totalQtyBase, qtyStep);
      return parseFloat(one) > 0 ? [one] : [];
    }
    const parts = this.splitPositionQtyForTps(
      totalQtyBase,
      childCount,
      qtyStep,
      minQty,
    ).filter((q) => parseFloat(q) > 0);
    if (parts.length > 0) {
      return parts;
    }
    const one = formatQtyToStep(totalQtyBase, qtyStep);
    return parseFloat(one) > 0 ? [one] : [];
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
    const qtyStepNum = parseFloat(params.qtyStep);
    const minQtyNum = parseFloat(params.minQty);
    const posSizeRounded = formatQtyToStep(params.posSize, params.qtyStep);
    const totalUnits =
      Number.isFinite(qtyStepNum) && qtyStepNum > 0
        ? floorQtyToStepUnits(params.posSize, qtyStepNum)
        : 0;
    const reasons: string[] = [];
    if (!Number.isFinite(qtyStepNum) || qtyStepNum <= 0) {
      reasons.push('invalid_qty_step');
    }
    if (!Number.isFinite(minQtyNum) || minQtyNum <= 0) {
      reasons.push('invalid_min_qty');
    }
    if (Number.isFinite(minQtyNum) && parseFloat(posSizeRounded) < minQtyNum) {
      reasons.push('position_below_min_qty');
    }
    if (params.requestedLevels > 1 && totalUnits > 0 && Number.isFinite(minQtyNum) && minQtyNum > 0) {
      const unitsPerLevel = Math.floor(totalUnits / params.requestedLevels);
      const qtyPerLevel = unitsPerLevel * qtyStepNum;
      if (!Number.isFinite(qtyPerLevel) || qtyPerLevel < minQtyNum) {
        reasons.push('per_tp_qty_below_min_qty');
      }
    }
    return {
      posSizeRounded,
      totalUnits,
      qtyStepNum: Number.isFinite(qtyStepNum) ? qtyStepNum : null,
      minQtyNum: Number.isFinite(minQtyNum) ? minQtyNum : null,
      reasons,
    };
  }

  private parseSourceMartingaleMap(raw: string | undefined): Map<string, number> {
    const out = new Map<string, number>();
    const text = String(raw ?? '').trim();
    if (!text) {
      return out;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return out;
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const key = String(k ?? '').trim().toLowerCase();
        const val = Number(v);
        if (!key || !Number.isFinite(val) || val <= 1) {
          continue;
        }
        out.set(key, val);
      }
      return out;
    } catch {
      return out;
    }
  }

  private async applySourceMartingaleSizing(
    signal: SignalDto,
    workspaceId?: string | null,
  ): Promise<SignalDto> {
    const sourceRaw = String(signal.source ?? '').trim();
    if (!sourceRaw) {
      return signal;
    }

    const [rawMap, rawDefault] = await Promise.all([
      this.settings.get('SOURCE_MARTINGALE_MULTIPLIERS', workspaceId),
      this.settings.get('SOURCE_MARTINGALE_DEFAULT_MULTIPLIER', workspaceId),
    ]);
    const bySource = this.parseSourceMartingaleMap(rawMap);
    const defaultMultiplierParsed = Number(rawDefault);
    const defaultMultiplier =
      Number.isFinite(defaultMultiplierParsed) && defaultMultiplierParsed > 1
        ? defaultMultiplierParsed
        : undefined;
    const multiplier = bySource.get(sourceRaw.toLowerCase()) ?? defaultMultiplier;
    if (!multiplier || !Number.isFinite(multiplier) || multiplier <= 1) {
      return signal;
    }

    const prev = await this.orders.getLatestClosedSignalBySource(sourceRaw, workspaceId);
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
      next.capitalPercent = Math.min(100, round(next.capitalPercent * multiplier));
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

  async placeSignalOrders(
    signal: SignalDto,
    rawMessage: string | undefined,
    origin?: { chatId?: string; messageId?: string; workspaceId?: string | null },
  ): Promise<PlaceOrdersResult> {
    const workspaceId = origin?.workspaceId?.trim() ? origin.workspaceId.trim() : null;
    signal = await this.applySourceMartingaleSizing(signal, workspaceId);
    const symbol = normalizeTradingPair(signal.pair);

    const testnetMode =
      (await this.settings.get('BYBIT_TESTNET', workspaceId)) === 'true';
    const client = await this.bybitClient.getClient(workspaceId);
    if (!client) {
      void this.appLog.append('error', 'bybit', 'placeSignalOrders: нет ключей API', {
        mode: testnetMode ? 'testnet' : 'mainnet',
      });
      return {
        ok: false,
        error: testnetMode
          ? 'Не заданы ключи Bybit для testnet (BYBIT_API_KEY_TESTNET / BYBIT_API_SECRET_TESTNET).'
          : 'Не заданы ключи Bybit для основного счёта (BYBIT_API_KEY_MAINNET / BYBIT_API_SECRET_MAINNET).',
      };
    }

    const lockKey = `${workspaceId ?? 'default'}:${symbol}:${signal.direction}`;
    return this.placementLock.runExclusive(lockKey, () =>
      this.placeSignalOrdersLocked(
        signal,
        rawMessage,
        origin,
        symbol,
        client,
        testnetMode,
        workspaceId,
      ),
    );
  }

  private async placeSignalOrdersLocked(
    signal: SignalDto,
    rawMessage: string | undefined,
    origin: { chatId?: string; messageId?: string; workspaceId?: string | null } | undefined,
    symbol: string,
    client: RestClientV5,
    _testnetMode: boolean,
    workspaceId: string | null,
  ): Promise<PlaceOrdersResult> {
    const side: 'Buy' | 'Sell' = signal.direction === 'long' ? 'Buy' : 'Sell';

    try {
      if (
        await this.exposure.hasExchangeExposureForDirection(
          client,
          symbol,
          signal.direction,
        )
      ) {
        void this.appLog.append('warn', 'bybit', 'placeSignalOrders: отказ (ордера/позиция на бирже по этой стороне)', {
          symbol,
          direction: signal.direction,
        });
        return {
          ok: false,
          error: `На Bybit по ${symbol} уже есть открытые ордера или позиция по стороне ${signal.direction.toUpperCase()}. Повторный вход в ту же сторону недоступен.`,
        };
      }
      await this.exposure.clearImmediateStaleDbBlockerIfExchangeFlat(
        symbol,
        signal.direction,
        client,
        'place-before-db-check',
      );
    } catch (e) {
      const msg = formatError(e);
      this.logger.warn(`Exchange activity check failed: ${msg}`);
      if (
        await this.orders.hasActiveSignalForPairAndDirection(
          signal.pair,
          signal.direction,
          workspaceId,
        )
      ) {
        void this.appLog.append('warn', 'bybit', 'placeSignalOrders: отказ (БД: ORDERS_PLACED, проверка биржи не удалась)', {
          symbol,
          direction: signal.direction,
        });
        return {
          ok: false,
          error: `По паре ${symbol} уже есть активный сигнал ${signal.direction.toUpperCase()} (ордера в работе). Дождитесь закрытия сделки.`,
        };
      }
    }

    if (
      await this.orders.hasActiveSignalForPairAndDirection(
        signal.pair,
        signal.direction,
        workspaceId,
      )
    ) {
      void this.appLog.append('warn', 'bybit', 'placeSignalOrders: отказ (активный сигнал в БД)', {
        symbol,
        direction: signal.direction,
      });
      return {
        ok: false,
        error: `По паре ${symbol} уже есть активный сигнал ${signal.direction.toUpperCase()} (ордера в работе). Дождитесь закрытия сделки.`,
      };
    }

    try {
      const lastPrice = await this.market.getLastPrice(client, symbol);
      if (!lastPrice) {
        void this.appLog.append(
          'warn',
          'bybit',
          'placeSignalOrders: last price unavailable',
          { symbol },
        );
      }
      const validationErr = this.validateSignalLevels(signal, lastPrice);
      if (validationErr) {
        void this.appLog.append('warn', 'bybit', 'placeSignalOrders: signal validation failed', {
          symbol,
          direction: signal.direction,
          entries: signal.entries,
          stopLoss: signal.stopLoss,
          takeProfits: signal.takeProfits,
          validationErr,
        });
        return { ok: false, error: validationErr };
      }

      void this.appLog.append('info', 'bybit', 'placeSignalOrders: старт', {
        symbol,
        side,
        entries: signal.entries.length,
        takeProfits: signal.takeProfits.length,
        orderUsd: signal.orderUsd,
        leverage: signal.leverage,
      });
      const balanceDetails = await this.market.getUsdtBalanceDetails(client);
      const balance = balanceDetails.availableUsd;
      const defaultOrderUsd = await this.settings.getDefaultOrderUsd(
        balanceDetails.totalUsd,
        workspaceId,
      );
      const minCapitalRaw = await this.settings.get('MIN_CAPITAL_AMOUNT', workspaceId);
      const minCapitalParsed =
        minCapitalRaw != null && minCapitalRaw.trim() !== ''
          ? parseFloat(minCapitalRaw)
          : Number.NaN;
      const MIN_PERCENT_NOTIONAL_USD =
        Number.isFinite(minCapitalParsed) && minCapitalParsed > 0
          ? minCapitalParsed
          : 5;
      let leveragedNotional: number;
      if (signal.orderUsd > 0) {
        leveragedNotional = signal.orderUsd;
      } else if (signal.capitalPercent > 0) {
        const margin = balance * (signal.capitalPercent / 100);
        leveragedNotional = margin * signal.leverage;
        if (leveragedNotional < MIN_PERCENT_NOTIONAL_USD) {
          void this.appLog.append(
            'warn',
            'bybit',
            'placeSignalOrders: percent sizing поднят до минимального номинала',
            {
              symbol,
              balance,
              capitalPercent: signal.capitalPercent,
              leverage: signal.leverage,
              calculatedNotional: leveragedNotional,
              minNotionalApplied: MIN_PERCENT_NOTIONAL_USD,
            },
          );
          leveragedNotional = MIN_PERCENT_NOTIONAL_USD;
        }
      } else {
        leveragedNotional = defaultOrderUsd;
      }
      const maxLeverageRaw = await this.settings.get('MAX_LEVERAGE', workspaceId);
      const maxLeverage =
        maxLeverageRaw != null && Number.isFinite(Number(maxLeverageRaw)) && Number(maxLeverageRaw) > 0
          ? Math.round(Number(maxLeverageRaw))
          : 50;
      const leverageInt = Math.min(Math.round(signal.leverage), maxLeverage);
      const levRes = await client.setLeverage({
        category: 'linear',
        symbol,
        buyLeverage: String(leverageInt),
        sellLeverage: String(leverageInt),
      });
      const levRc = (levRes as { retCode?: number }).retCode ?? levRes.retCode;
      if (levRc !== 0 && levRc !== 110043) {
        const levErr = formatError((levRes as { retMsg?: string }).retMsg ?? 'setLeverage failed');
        void this.appLog.append('error', 'bybit', 'placeSignalOrders: setLeverage отклонён', {
          symbol,
          leverage: leverageInt,
          retCode: levRc,
          retMsg: levErr,
        });
        return { ok: false, error: `Не удалось установить плечо ${leverageInt}x: ${levErr}` };
      }

      const { qtyStep, minQty, tickSize } = await this.market.getLinearInstrumentFilters(
        client,
        symbol,
      );
      const minQtyNum = parseFloat(minQty);
      const requestedEntries = signal.entries;
      const rangePlan = this.applyEntryRangeResolution(signal, lastPrice, tickSize);
      if (!rangePlan.ok) {
        void this.appLog.append('warn', 'bybit', 'placeSignalOrders: диапазон входа отклонён', {
          symbol,
          error: rangePlan.error,
        });
        return { ok: false, error: rangePlan.error };
      }
      let effectiveEntries = rangePlan.effectiveEntries;
      let weights = rangePlan.weights;

      /**
       * Если бюджет не позволяет проставить все заданные входы (qty по какому-то входу
       * меньше минимального лота), деградируем к одному входу на полный номинал.
       */
      if (effectiveEntries.length > 1) {
        const hasInsufficientSlice = effectiveEntries.some((price, i) => {
          const share = weights[i] ?? 1 / effectiveEntries.length;
          const notionalSlice = leveragedNotional * share;
          const qtyRaw = notionalSlice / price;
          return !Number.isFinite(qtyRaw) || qtyRaw < minQtyNum;
        });
        if (hasInsufficientSlice) {
          effectiveEntries = [effectiveEntries[0]!];
          weights = [1];
          void this.appLog.append(
            'warn',
            'bybit',
            'placeSignalOrders: входы уменьшены до 1 из-за недостаточного номинала под minQty',
            {
              symbol,
              leveragedNotional,
              requestedEntries: requestedEntries.length,
              usedEntries: effectiveEntries.length,
              minQty: minQtyNum,
              firstEntryPrice: effectiveEntries[0],
            },
          );
        }
      }

      const bumpToMin = await this.resolveBumpToMinExchangeLot(origin?.chatId, workspaceId);
      const minQtyErr = this.validateLeveragedNotionalVsMinQty({
        leveragedNotional,
        effectiveEntries,
        weights,
        lastPrice,
        minQtyNum,
        symbol,
      });
      if (minQtyErr) {
        if (bumpToMin) {
          void this.appLog.append(
            'info',
            'bybit',
            'placeSignalOrders: номинал ниже minQty — увеличение qty до мин. лота (BUMP_TO_MIN_EXCHANGE_LOT / minLotBump)',
            {
              symbol,
              leveragedNotional,
              minQty: minQtyNum,
              entries: effectiveEntries.length,
              lastPrice,
              chatId: origin?.chatId ?? null,
            },
          );
        } else {
          void this.appLog.append(
            'warn',
            'bybit',
            'placeSignalOrders: номинал ниже minQty биржи (отказ до ордера)',
            {
              symbol,
              leveragedNotional,
              minQty: minQtyNum,
              entries: effectiveEntries.length,
              lastPrice,
            },
          );
          return { ok: false, error: minQtyErr };
        }
      }

      const signalRow = await this.orders.createSignalRecord(
        {
          ...signal,
          entries: effectiveEntries,
        },
        rawMessage,
        'PLACING',
        origin,
      );

      const bybitIds: string[] = [];
      /**
       * Только входы. TP — отдельные reduce-only лимитки после исполнения всех входов
       * (по одному ордеру на каждый уровень TP, позиция делится поровну).
       */

      if (effectiveEntries.length === 0) {
        if (!lastPrice) {
          await this.orders.updateSignalStatus(signalRow.id, {
            status: 'FAILED',
          });
          return {
            ok: false,
            error: 'Не удалось получить текущую цену для рыночного входа',
            signalId: signalRow.id,
          };
        }

        const qtyNum = leveragedNotional / lastPrice;
        const qty = roundQty(qtyNum, qtyStep, minQty);
        const orderRes = await client.submitOrder({
          category: 'linear',
          symbol,
          side,
          orderType: 'Market',
          qty,
          positionIdx: 0,
        });

        const oid = orderRes.result?.orderId;
        if (oid) {
          bybitIds.push(oid);
        }

        await this.orders.createOrderRecord({
          signalId: signalRow.id,
          bybitOrderId: oid,
          orderKind: 'ENTRY',
          side,
          price: lastPrice,
          qty: parseFloat(qty),
          status: orderRes.retCode === 0 ? 'NEW' : 'FAILED',
        });

        if (orderRes.retCode !== 0) {
          const errText = formatError(orderRes.retMsg ?? 'submitOrder failed');
          void this.appLog.append('error', 'bybit', 'submitOrder Market отклонён', {
            symbol,
            retCode: orderRes.retCode,
            retMsg: errText,
          });
          await this.orders.updateSignalStatus(signalRow.id, {
            status: 'FAILED',
          });
          return {
            ok: false,
            error: errText,
            signalId: signalRow.id,
          };
        }
      } else {
        for (let i = 0; i < effectiveEntries.length; i++) {
        const price = effectiveEntries[i]!;
        const share = weights[i] ?? 1 / effectiveEntries.length;
        const notionalSlice = leveragedNotional * share;
        const qtyNum = notionalSlice / price;
        const qty = roundQty(qtyNum, qtyStep, minQty);
        const shouldUseStop =
          lastPrice !== undefined
            ? signal.direction === 'short'
              ? snapPriceToTickNum(price, tickSize) <
                snapPriceToTickNum(lastPrice, tickSize)
              : snapPriceToTickNum(price, tickSize) >
                snapPriceToTickNum(lastPrice, tickSize)
            : false;

        const orderReq = {
          category: 'linear' as const,
          symbol,
          side,
          orderType: 'Limit' as const,
          qty,
          price: String(price),
          timeInForce: 'GTC' as const,
          positionIdx: 0 as const,
          ...(shouldUseStop
            ? {
                orderFilter: 'StopOrder' as const,
                triggerPrice: String(price),
                triggerBy: 'LastPrice' as const,
                triggerDirection: (signal.direction === 'short' ? 2 : 1) as 1 | 2,
              }
            : {}),
        };

        const orderRes = await client.submitOrder(orderReq);

        const oid = orderRes.result?.orderId;
        if (oid) {
          bybitIds.push(oid);
        }

        await this.orders.createOrderRecord({
          signalId: signalRow.id,
          bybitOrderId: oid,
          orderKind: i === 0 ? 'ENTRY' : 'DCA',
          side,
          price,
          qty: parseFloat(qty),
          status: orderRes.retCode === 0 ? 'NEW' : 'FAILED',
        });

          if (orderRes.retCode !== 0) {
            const errText = formatError(orderRes.retMsg ?? 'submitOrder failed');
            const isDca = i > 0;
            const insufficient = isInsufficientBalanceError(errText);

            if (isDca && insufficient) {
              this.logger.warn(
                `DCA skipped due to insufficient balance ${symbol} index=${i}: ${errText}`,
              );
              void this.appLog.append(
                'warn',
                'bybit',
                'DCA пропущен: недостаточно маржи/баланса',
                {
                  symbol,
                  signalId: signalRow.id,
                  entryIndex: i,
                  retCode: orderRes.retCode,
                  retMsg: errText,
                },
              );
              continue;
            }

            void this.appLog.append('error', 'bybit', 'submitOrder отклонён', {
              symbol,
              entryIndex: i,
              retCode: orderRes.retCode,
              retMsg: errText,
            });
            await this.orders.updateSignalStatus(signalRow.id, {
              status: 'FAILED',
            });
            return {
              ok: false,
              error: errText,
              signalId: signalRow.id,
            };
          }
        }
      }

      await this.orders.updateSignalStatus(signalRow.id, {
        status: 'ORDERS_PLACED',
      });

      void this.appLog.append('info', 'bybit', 'placeSignalOrders: успех', {
        symbol,
        signalId: signalRow.id,
        bybitOrderIds: bybitIds,
      });
      return {
        ok: true,
        signalId: signalRow.id,
        bybitOrderIds: bybitIds,
      };
    } catch (e) {
      const msg = formatError(e);
      this.logger.error(`placeSignalOrders: ${msg}`);
      void this.appLog.append('error', 'bybit', 'placeSignalOrders: исключение', {
        symbol,
        error: msg,
      });
      return { ok: false, error: msg };
    }
  }

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
      return isOpenOrderStatus(o.status);
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
      return isOpenOrderStatus(o.status);
    });
  }

  /**
   * SL на всю позицию (UTA). Без `tpslMode` Bybit V5 часто отклоняет запрос.
   */
  private async applyPositionStopLossFull(
    client: RestClientV5,
    symbol: string,
    stopLoss: number,
    context: string,
    positionIdx: 0 | 1 | 2 = 0,
  ): Promise<boolean> {
    try {
      // Если SL заведомо по неверную сторону от цены позиции, не долбим биржу повторно.
      try {
        const pos = await client.getPositionInfo({
          category: 'linear',
          symbol,
        });
        if (pos.retCode === 0) {
          const rows = pos.result?.list ?? [];
          const row =
            rows.find((r) => {
              const idx = Number(r.positionIdx ?? 0);
              const sz = r?.size ? Math.abs(parseFloat(String(r.size))) : 0;
              return idx === positionIdx && sz > 1e-12;
            }) ??
            rows.find((r) => {
              const sz = r?.size ? Math.abs(parseFloat(String(r.size))) : 0;
              return sz > 1e-12;
            });

          const side = String(row?.side ?? '');
          const basePrice = Number(row?.avgPrice ?? 0);
          if (Number.isFinite(basePrice) && basePrice > 0) {
            const invalidForShort = side === 'Sell' && !(stopLoss > basePrice);
            const invalidForLong = side === 'Buy' && !(stopLoss < basePrice);
            if (invalidForShort || invalidForLong) {
              this.logger.debug(
                `skip setTradingStop (${context}) ${symbol}: SL=${stopLoss} invalid for side=${side} base=${basePrice}`,
              );
              return false;
            }
          }
        }
      } catch {
        // ignore pre-check errors; main call below will provide final result
      }

      const res = await client.setTradingStop({
        category: 'linear',
        symbol,
        positionIdx,
        tpslMode: 'Full',
        stopLoss: String(stopLoss),
        slTriggerBy: 'LastPrice',
        /** При Full режиме Bybit допускает только Market для SL/TP (см. официальную таблицу параметров). */
        slOrderType: 'Market',
      });
      if (res.retCode === 34040) {
        return true;
      }
      if (res.retCode !== 0) {
        this.logger.warn(
          `setTradingStop SL (${context}) ${symbol}: retCode=${res.retCode} ${res.retMsg}`,
        );
        void this.appLog.append('warn', 'bybit', 'setTradingStop SL отклонён', {
          symbol,
          context,
          retCode: res.retCode,
          retMsg: String(res.retMsg ?? ''),
        });
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(
        `setTradingStop SL (${context}) ${symbol}: ${formatError(e)}`,
      );
      void this.appLog.append('warn', 'bybit', 'setTradingStop SL исключение', {
        symbol,
        context,
        error: formatError(e),
      });
      return false;
    }
  }

  /**
   * Несколько TP: пока лимитки входов не исполнены — TP/SL **не** вешаются на ордер (так задумано).
   * Как только появляется позиция — выставляем SL на всю позицию (через poll).
   * После исполнения **всех** входов — SL (ещё раз, безопасно) + reduce-only TP лимитки.
   */
  async ensureStopLossForMultiTpOpenPosition(
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
    let tps: number[];
    try {
      tps = JSON.parse(sig.takeProfits) as number[];
    } catch {
      return;
    }
    if (tps.length <= 1) {
      return;
    }
    if (sig.orders.some((o) => o.orderKind === 'TP')) {
      return;
    }

    const symbol = normalizeTradingPair(sig.pair);
    const posRes = await client.getPositionInfo({
      category: 'linear',
      symbol,
    });
    if (posRes.retCode !== 0) {
      return;
    }
    const rows = posRes.result?.list ?? [];
    const dir = sig.direction === 'short' ? 'short' : 'long';
    const mainRow = pickPositionRowForSignalDirection(rows, dir);
    if (!mainRow) {
      return;
    }
    const mainSide = String(mainRow.side ?? '').toLowerCase();
    if (
      (dir === 'long' && mainSide !== 'buy') ||
      (dir === 'short' && mainSide !== 'sell')
    ) {
      return;
    }
    const posSize = mainRow?.size
      ? Math.abs(parseFloat(String(mainRow.size)))
      : 0;
    if (posSize <= 1e-12) {
      return;
    }

    if (positionHasStopLoss(mainRow)) {
      return;
    }

    const positionIdx = (mainRow?.positionIdx ?? 0) as 0 | 1 | 2;
    await this.applyPositionStopLossFull(
      client,
      symbol,
      sig.stopLoss,
      'multi_tp_early',
      positionIdx,
    );
  }

  /**
   * Как только появляется позиция — синхронизируем TP/SL под её текущий размер.
   * Если объём позиции вырос после частичных входов, довыставляем недостающие TP
   * только на непокрытую часть.
   */
  async placeTpSplitIfNeeded(
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
    const s = await this.orders.getSignalWithOrders(fresh.id);
    if (!s) {
      return;
    }

    let takeProfits: number[];
    try {
      takeProfits = JSON.parse(s.takeProfits) as number[];
    } catch {
      return;
    }
    if (takeProfits.length < 1) {
      return;
    }

    const entryOrders = s.orders.filter(
      (o) => o.orderKind === 'ENTRY' || o.orderKind === 'DCA',
    );
    if (entryOrders.length === 0) {
      return;
    }

    const avgEntry =
      entryOrders.reduce((sum, o) => sum + (o.price ?? 0), 0) / entryOrders.length;
    if (Number.isFinite(avgEntry) && avgEntry > 0) {
      takeProfits.sort((a, b) => Math.abs(a - avgEntry) - Math.abs(b - avgEntry));
    }

    for (const o of entryOrders) {
      if (!o.bybitOrderId) {
        continue;
      }
      const st = await this.exposure.fetchOrderStatusFromExchange(
        client,
        s.pair,
        o.bybitOrderId,
        o.qty != null ? Number(o.qty) : undefined,
      );
      if (st && st !== o.status) {
        const stLow = st.trim().toLowerCase();
        await this.orders.updateOrder(o.id, {
          status: st,
          filledAt:
            stLow === 'filled' || stLow === 'partiallyfilled'
              ? new Date()
              : undefined,
        });
      }
    }

    let s2 = await this.orders.getSignalWithOrders(fresh.id);
    if (!s2) {
      return;
    }

    // Если в БД вход ещё не Filled, но на бирже уже есть позиция по стороне сигнала — доверяем бирже
    // (часто Market/лаг API: ордер остаётся New, позиция уже открыта; иначе TP никогда не выставится).
    if (!this.hasFilledEntryOrders(s2.orders)) {
      const symbolProbe = normalizeTradingPair(s2.pair);
      const posProbe = await client.getPositionInfo({
        category: 'linear',
        symbol: symbolProbe,
      });
      const dirProbe = s2.direction === 'short' ? 'short' : 'long';
      const rowProbe = pickPositionRowForSignalDirection(
        posProbe.result?.list ?? [],
        dirProbe,
      );
      const sideProbe = String(rowProbe?.side ?? '').toLowerCase();
      const sizeProbe = rowProbe?.size
        ? Math.abs(parseFloat(String(rowProbe.size)))
        : 0;
      const hasLive =
        rowProbe &&
        sizeProbe > 1e-12 &&
        ((dirProbe === 'long' && sideProbe === 'buy') ||
          (dirProbe === 'short' && sideProbe === 'sell'));
      if (!hasLive) {
        this.logger.debug(
          `placeTpSplitIfNeeded: skip ${symbolProbe} — no filled entries yet`,
        );
        return;
      }
      void this.appLog.append(
        'warn',
        'bybit',
        'placeTpSplit: ENTRY в БД не Filled/PartiallyFilled, позиция на бирже есть — помечаем входы исполненными',
        { signalId: s2.id, pair: symbolProbe, positionSize: sizeProbe },
      );
      for (const o of s2.orders) {
        const ost = (o.status ?? '').trim().toLowerCase();
        if (
          ost === 'cancelled' ||
          ost === 'deactivated' ||
          ost === 'rejected'
        ) {
          continue;
        }
        if (
          (o.orderKind === 'ENTRY' || o.orderKind === 'DCA') &&
          o.bybitOrderId &&
          !isFilledOrderStatus(o.status) &&
          ost !== 'partiallyfilled'
        ) {
          await this.orders.updateOrder(o.id, {
            status: 'Filled',
            filledAt: new Date(),
          });
        }
      }
      const s2ref = await this.orders.getSignalWithOrders(fresh.id);
      if (!s2ref) {
        return;
      }
      s2 = s2ref;
    }

    const symbol = normalizeTradingPair(s2.pair);
    const posRes = await client.getPositionInfo({
      category: 'linear',
      symbol,
    });
    if (posRes.retCode !== 0) {
      void this.appLog.append('warn', 'bybit', 'placeTpSplit: getPositionInfo', {
        symbol,
        retCode: posRes.retCode,
        retMsg: String(posRes.retMsg ?? ''),
      });
      return;
    }
    const rows = posRes.result?.list ?? [];
    const dir = s2.direction === 'short' ? 'short' : 'long';
    const rowWithPos =
      pickPositionRowForSignalDirection(rows, dir);
    if (!rowWithPos) {
      return;
    }
    const posSide = String(rowWithPos.side ?? '').toLowerCase();
    if (
      (dir === 'long' && posSide !== 'buy') ||
      (dir === 'short' && posSide !== 'sell')
    ) {
      return;
    }
    const sizeStr = rowWithPos?.size;
    const posSize = sizeStr ? Math.abs(parseFloat(String(sizeStr))) : 0;
    if (posSize <= 0) {
      return;
    }
    const positionIdx = (rowWithPos?.positionIdx ?? 0) as 0 | 1 | 2;
    const closeSide = s2.direction === 'long' ? 'Sell' : 'Buy';

    const { qtyStep, minQty, tickSize } =
      await this.market.getLinearInstrumentFilters(client, symbol);

    await this.applyPositionStopLossFull(
      client,
      symbol,
      s2.stopLoss,
      'tp_one_per_level',
      positionIdx,
    );

    const tpChildrenPerLevel = 1;
    const requestedTpLevels = takeProfits.length;

    let n = takeProfits.length;
    let qtyParts: string[] = [];
    let usedSingleTpFallback = false;
    while (n >= 1) {
      qtyParts = this.splitPositionQtyForTps(
        posSize,
        n,
        qtyStep,
        minQty,
      );
      if (qtyParts.length > 0) {
        break;
      }
      n--;
    }

    if (qtyParts.length === 0) {
      const singleTpQtyParts = this.splitQtyForChildOrders(
        posSize,
        1,
        qtyStep,
        minQty,
      );
      if (singleTpQtyParts.length > 0) {
        qtyParts = singleTpQtyParts;
        n = 1;
        usedSingleTpFallback = true;
      }
    }

    const activeTpPrices = takeProfits.slice(0, Math.max(n, 0));

    let totalTpPlaced = 0;

    if (qtyParts.length === 0) {
      const splitDiag = this.buildTpSplitDiagnostics({
        posSize,
        requestedLevels: requestedTpLevels,
        qtyStep,
        minQty,
      });
      void this.appLog.append('warn', 'bybit', 'placeTpSplit: не удалось разбить позицию по уровням TP', {
        symbol,
        posSize,
        posSizeRounded: splitDiag.posSizeRounded,
        tpLevelsRequested: requestedTpLevels,
        qtyStep,
        minQty,
        totalUnits: splitDiag.totalUnits,
        reasons: splitDiag.reasons,
      });
      return;
    }
    if (usedSingleTpFallback) {
      const splitDiag = this.buildTpSplitDiagnostics({
        posSize,
        requestedLevels: requestedTpLevels,
        qtyStep,
        minQty,
      });
      void this.appLog.append(
        'warn',
        'bybit',
        'placeTpSplit: multi-TP не влез в лот, используем один TP на всю позицию',
        {
          symbol,
          posSize,
          posSizeRounded: splitDiag.posSizeRounded,
          requestedLevels: requestedTpLevels,
          usedLevels: 1,
          fallbackTpPrice: activeTpPrices[0] ?? null,
          fallbackQty: qtyParts[0] ?? null,
          qtyStep,
          minQty,
          totalUnits: splitDiag.totalUnits,
          reasons: splitDiag.reasons,
        },
      );
    } else if (n < requestedTpLevels) {
      const splitDiag = this.buildTpSplitDiagnostics({
        posSize,
        requestedLevels: requestedTpLevels,
        qtyStep,
        minQty,
      });
      void this.appLog.append('warn', 'bybit', 'placeTpSplit: число TP уменьшено из-за minQty лота', {
        symbol,
        posSize,
        posSizeRounded: splitDiag.posSizeRounded,
        requestedLevels: requestedTpLevels,
        usedLevels: n,
        qtyStep,
        minQty,
        totalUnits: splitDiag.totalUnits,
        reasons: splitDiag.reasons,
      });
    }

    // Иначе в БД остаётся NEW по TP, а на бирже ордер уже снят — считаем «достаточно живых» и не шлём TP снова (tpOrdersPlaced: 0).
    const tpOrdersToSync = s2.orders.filter(
      (o) => o.orderKind === 'TP' && o.bybitOrderId,
    );
    for (const o of tpOrdersToSync) {
      const st = await this.exposure.fetchOrderStatusFromExchange(
        client,
        s2.pair,
        o.bybitOrderId!,
        o.qty != null ? Number(o.qty) : undefined,
      );
      if (st && st !== o.status) {
        const stLow = st.trim().toLowerCase();
        await this.orders.updateOrder(o.id, {
          status: st,
          filledAt:
            stLow === 'filled' || stLow === 'partiallyfilled'
              ? new Date()
              : undefined,
        });
      }
    }
    const s2AfterTpSync = await this.orders.getSignalWithOrders(fresh.id);
    if (s2AfterTpSync) {
      s2 = s2AfterTpSync;
    }

    const liveTpByPrice = new Map<string, number>();
    const filledTpByPrice = new Map<string, number>();
    for (const o of s2.orders) {
      if (o.orderKind !== 'TP') {
        continue;
      }
      if (o.price === null || o.price === undefined) {
        continue;
      }
      const p = formatPriceToTick(Number(o.price), tickSize);
      if (isOpenOrderStatus(o.status)) {
        liveTpByPrice.set(p, (liveTpByPrice.get(p) ?? 0) + 1);
      } else if (isFilledOrderStatus(o.status)) {
        filledTpByPrice.set(p, (filledTpByPrice.get(p) ?? 0) + 1);
      }
    }

    for (let ti = 0; ti < activeTpPrices.length; ti++) {
      const tpPrice = activeTpPrices[ti]!;
      const levelQtyStr = qtyParts[ti];
      if (!levelQtyStr || parseFloat(levelQtyStr) <= 0) {
        void this.appLog.append('warn', 'bybit', 'placeTpSplit: пропуск уровня TP — нулевой qty в разбиении', {
          symbol,
          signalId: s2.id,
          tpIndex: ti,
          tpPrice,
          qtyPartsLen: qtyParts.length,
        });
        continue;
      }

      const levelQty = parseFloat(levelQtyStr);
      const childQtyParts = this.splitQtyForChildOrders(
        levelQty,
        tpChildrenPerLevel,
        qtyStep,
        minQty,
      );
      if (childQtyParts.length === 0) {
        continue;
      }
      const priceStr = formatPriceToTick(tpPrice, tickSize);
      const existingAtPrice = liveTpByPrice.get(priceStr) ?? 0;
      const alreadyFilledAtPrice = filledTpByPrice.get(priceStr) ?? 0;
      // Сколько уровней TP после округления к тику дают эту же цену (иначе два TP «схлопываются» в один priceStr,
      // а target по childQtyParts.length=1 давал missing=0 после первого ордера — второй уровень не выставлялся).
      const levelsSharingPrice = activeTpPrices.filter((p, idx) => {
        const qs = qtyParts[idx];
        if (!qs || parseFloat(qs) <= 0) {
          return false;
        }
        return formatPriceToTick(p, tickSize) === priceStr;
      }).length;
      const slotsThisLevel = childQtyParts.length;
      const targetAtPrice = Math.max(
        0,
        levelsSharingPrice - alreadyFilledAtPrice,
      );
      let missingAtPrice = Math.max(0, targetAtPrice - existingAtPrice);
      if (missingAtPrice <= 0) {
        void this.appLog.append(
          'warn',
          'bybit',
          'placeTpSplit: уровень TP пропущен — в БД уже учтены ордера на этой цене (проверьте, что статусы совпадают с биржей)',
          {
            symbol,
            signalId: s2.id,
            tpIndex: ti,
            priceStr,
            existingAtPrice,
            alreadyFilledAtPrice,
            targetAtPrice,
            levelsSharingPrice,
            slotsThisLevel,
          },
        );
        continue;
      }

      for (const qtyPart of childQtyParts) {
        if (missingAtPrice <= 0) {
          break;
        }
        const orderRes = await client.submitOrder({
          category: 'linear',
          symbol,
          side: closeSide,
          orderType: 'Limit',
          qty: qtyPart,
          price: priceStr,
          timeInForce: 'GTC',
          positionIdx,
          reduceOnly: true,
        });
        const oid = orderRes.result?.orderId;
        await this.orders.createOrderRecord({
          signalId: s2.id,
          bybitOrderId: oid,
          orderKind: 'TP',
          side: closeSide,
          price: tpPrice,
          qty: parseFloat(qtyPart),
          status: orderRes.retCode === 0 ? 'NEW' : 'FAILED',
        });
        if (orderRes.retCode === 0) {
          totalTpPlaced++;
          missingAtPrice--;
          liveTpByPrice.set(priceStr, (liveTpByPrice.get(priceStr) ?? 0) + 1);
        } else {
          this.logger.warn(
            `TP reduce-only (уровень ${ti}) ${symbol}: ${formatError(orderRes.retMsg ?? 'submitOrder')}`,
          );
          void this.appLog.append('warn', 'bybit', 'TP: отказ reduce-only', {
            symbol,
            tpIndex: ti,
            retCode: orderRes.retCode,
            retMsg: String(orderRes.retMsg ?? ''),
          });
        }
      }
    }

    this.logger.log(
      `placeTpSplitIfNeeded: ${symbol} tpLevels=${activeTpPrices.length} perLevel=${tpChildrenPerLevel} placed=${totalTpPlaced}`,
    );
    void this.appLog.append('info', 'bybit', 'TP: ордера синхронизированы', {
      symbol,
      signalId: s2.id,
      positionSize: posSize,
      takeProfitLevels: activeTpPrices.length,
      tpOrdersPerLevel: tpChildrenPerLevel,
      tpOrdersPlaced: totalTpPlaced,
    });
    if (totalTpPlaced === 0 && activeTpPrices.length > 0 && qtyParts.length > 0) {
      void this.appLog.append(
        'warn',
        'bybit',
        'placeTpSplit: tpOrdersPlaced=0 при ненулевом разбиении — см. отказы reduce-only или пропуски уровней выше',
        {
          symbol,
          signalId: s2.id,
          activeTpPrices,
          qtyParts,
        },
      );
    }
  }
}
