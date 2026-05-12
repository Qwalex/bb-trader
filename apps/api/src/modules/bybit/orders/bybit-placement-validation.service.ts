import { Injectable } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { AppLogService } from '../../app-log/app-log.service';
import { BybitRateLimitService } from '../instrument/bybit-rate-limit.service';
import {
  buildTpSplitDiagnostics as buildTpSplitDiagnosticsUtil,
  entryNotionalWeights as entryNotionalWeightsUtil,
  floorQtyToStepUnits as floorQtyToStepUnitsUtil,
  formatPriceToTick as formatPriceToTickUtil,
  formatQtyToStep as formatQtyToStepUtil,
  snapPriceToTickNum as snapPriceToTickNumUtil,
  splitPositionQtyForTps as splitPositionQtyForTpsUtil,
  splitQtyForChildOrders as splitQtyForChildOrdersUtil,
} from '../instrument/bybit-qty.util';

@Injectable()
export class BybitPlacementValidationService {
  constructor(
    private readonly appLog: AppLogService,
    private readonly rateLimit: BybitRateLimitService,
  ) {}

  formatQtyToStep(qty: number, qtyStep: string): string {
    return formatQtyToStepUtil(qty, qtyStep);
  }

  formatPriceToTick(price: number, tickSize: string): string {
    return formatPriceToTickUtil(price, tickSize);
  }

  snapPriceToTickNum(price: number, tickSize: string): number {
    return snapPriceToTickNumUtil(price, tickSize);
  }

  roundQty(qty: number, step: string, minQty: string): string {
    const stepNum = parseFloat(step);
    const min = parseFloat(minQty);
    const roundedDown = floorQtyToStepUnitsUtil(qty, stepNum) * stepNum;
    const q = Math.max(roundedDown, min);
    const decimals = (step.split('.')[1] ?? '').length;
    return q.toFixed(decimals);
  }

  validateLeveragedNotionalVsMinQty(params: {
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
        const singleEntry = effectiveEntries.length === 1;
        return singleEntry
          ? `Номинал позиции ${notionalSlice.toFixed(2)} USDT меньше минимального лота для ${symbol}: при цене ~${price.toFixed(2)} нужно не меньше ~${minUsd.toFixed(2)} USDT (мин. количество ${minQtyNum}).`
          : `Доля номинала на вход ${i + 1} (${notionalSlice.toFixed(2)} USDT) меньше минимального лота для ${symbol}: при цене ~${price.toFixed(2)} нужно не меньше ~${minUsd.toFixed(2)} USDT (мин. количество ${minQtyNum}).`;
      }
    }
    return undefined;
  }

  validateSignalLevels(
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

  buildPlacementLockKey(
    cabinetId: string,
    pair: string,
    direction: 'long' | 'short',
  ): string {
    const seg = cabinetId.trim() || 'default';
    return `${seg}:${normalizeTradingPair(pair)}:${direction}`;
  }

  async resolveEntryPositionIdx(
    client: RestClientV5,
    symbol: string,
    side: 'Buy' | 'Sell',
  ): Promise<0 | 1 | 2> {
    try {
      const pos = await this.rateLimit.runBybitCall(() =>
        client.getPositionInfo({
          category: 'linear',
          symbol,
        }),
      );
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

  applyEntryRangeResolution(
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

  entryNotionalWeights(entryCount: number): number[] {
    return entryNotionalWeightsUtil(entryCount);
  }

  splitPositionQtyForTps(
    totalQtyBase: number,
    tpCount: number,
    qtyStep: string,
    minQty: string,
  ): string[] {
    return splitPositionQtyForTpsUtil({ totalQtyBase, tpCount, qtyStep, minQty });
  }

  splitQtyForChildOrders(
    totalQtyBase: number,
    childCount: number,
    qtyStep: string,
    minQty: string,
  ): string[] {
    return splitQtyForChildOrdersUtil({ totalQtyBase, childCount, qtyStep, minQty });
  }

  buildTpSplitDiagnostics(params: {
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
}
