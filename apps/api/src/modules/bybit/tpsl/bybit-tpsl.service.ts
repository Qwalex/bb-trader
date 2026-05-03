import { Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { AppLogService } from '../../app-log/app-log.service';
import {
  parseSourceTpSlStepMap,
  parseSourceTpSlStepRangeMap,
  parseTpSlStepRangeOptional,
  parseTpSlStepStart,
  resolveEffectiveTpSlRange,
  tpSlStepStartToTpNumber,
  type TpSlStepStartMode,
} from '../../settings/tp-sl-step.util';
import {
  BYBIT_LADDER_SOURCE_FALLBACK_LOG_CAP,
  BYBIT_SOURCE_MAP_SKIP_LOG_CAP,
} from '../bybit.constants';
import { pickPositionRowForSignalDirection } from '../position/bybit-position-pick.util';
import { positionHasStopLoss } from './bybit-tpsl.util';

@Injectable()
export class BybitTpSlService {
  private readonly logger = new Logger(BybitTpSlService.name);
  private lastWarnedInvalidGlobalTpSlRange: string | null = null;
  private readonly ladderSourceGlobalFallbackLogged = new Set<string>();
  private readonly sourceTpMapSkipLogged = new Set<string>();

  constructor(private readonly appLog: AppLogService) {}

  async applyPositionStopLossFull(
    client: RestClientV5,
    symbol: string,
    stopLoss: number,
    context: string,
    positionIdx: 0 | 1 | 2 = 0,
  ): Promise<{ ok: boolean; failReason?: string }> {
    try {
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
          const refRaw = row?.markPrice ?? '';
          const ref = parseFloat(String(refRaw));
          if (Number.isFinite(ref) && ref > 0) {
            const invalidForShort = side === 'Sell' && !(stopLoss > ref);
            const invalidForLong = side === 'Buy' && !(stopLoss < ref);
            if (invalidForShort || invalidForLong) {
              const failReason = `precheck: SL=${stopLoss} invalid for side=${side} mark=${ref}`;
              this.logger.debug(
                `skip setTradingStop (${context}) ${symbol}: ${failReason}`,
              );
              return { ok: false, failReason };
            }
          }
        }
      } catch {
        // ignore pre-check errors
      }

      const res = await client.setTradingStop({
        category: 'linear',
        symbol,
        positionIdx,
        tpslMode: 'Full',
        stopLoss: String(stopLoss),
        slTriggerBy: 'LastPrice',
        slOrderType: 'Market',
      });
      if (res.retCode === 34040) {
        return { ok: true };
      }
      if (res.retCode !== 0) {
        const retMsg = String(res.retMsg ?? '');
        const failReason = `retCode=${res.retCode} retMsg=${retMsg}`;
        this.logger.warn(`setTradingStop SL (${context}) ${symbol}: ${failReason}`);
        void this.appLog.append('warn', 'bybit', 'setTradingStop SL отклонён', {
          symbol,
          context,
          retCode: res.retCode,
          retMsg,
        });
        return { ok: false, failReason };
      }
      return { ok: true };
    } catch (e) {
      const failReason = formatError(e);
      this.logger.warn(`setTradingStop SL (${context}) ${symbol}: ${failReason}`);
      void this.appLog.append('warn', 'bybit', 'setTradingStop SL исключение', {
        symbol,
        context,
        error: failReason,
      });
      return { ok: false, failReason };
    }
  }

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
    helpers: {
      pickPositionRowForSignalDirection: (
        rows: Array<{ size?: string; side?: string; positionIdx?: number; stopLoss?: string }>,
        direction: 'long' | 'short',
      ) => { size?: string; side?: string; positionIdx?: number; stopLoss?: string } | undefined;
    },
  ): Promise<void> {
    let tps: number[];
    try {
      tps = JSON.parse(sig.takeProfits) as number[];
    } catch {
      return;
    }
    if (tps.length <= 1) return;
    if (sig.orders.some((o) => o.orderKind === 'TP')) return;

    const symbol = normalizeTradingPair(sig.pair);
    const posRes = await client.getPositionInfo({ category: 'linear', symbol });
    if (posRes.retCode !== 0) return;
    const rows = posRes.result?.list ?? [];
    const dir = sig.direction === 'short' ? 'short' : 'long';
    const mainRow = helpers.pickPositionRowForSignalDirection(rows, dir);
    if (!mainRow) return;
    const mainSide = String(mainRow.side ?? '').toLowerCase();
    if ((dir === 'long' && mainSide !== 'buy') || (dir === 'short' && mainSide !== 'sell')) {
      return;
    }
    const posSize = mainRow?.size ? Math.abs(parseFloat(String(mainRow.size))) : 0;
    if (posSize <= 1e-12) return;
    if (positionHasStopLoss(mainRow)) return;

    const positionIdx = (mainRow?.positionIdx ?? 0) as 0 | 1 | 2;
    await this.applyPositionStopLossFull(client, symbol, sig.stopLoss, 'multi_tp_early', positionIdx);
  }

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

  async resolveTpSlLadderConfigForSignal(
    source: string | null | undefined,
    ports: any,
  ): Promise<{ mode: TpSlStepStartMode; startNum: number; rangeNum: number } | null> {
    const [mapRaw, rangeMapRaw, scopedSource] = await Promise.all([
      ports.settings.get('SOURCE_TP_SL_STEP_START'),
      ports.settings.get('SOURCE_TP_SL_STEP_RANGE'),
      ports.getCabinetSourceByTitle(String(source ?? '')),
    ]);
    const map = parseSourceTpSlStepMap(mapRaw, (kind, entryKey, val) => {
      if (!this.takeSourceTpMapSkipLogSlot(kind, entryKey, val)) {
        return;
      }
      const label = kind === 'start' ? 'START' : 'RANGE';
      this.logger.warn(
        `SOURCE_TP_SL_STEP_${label}: пропущена невалидная запись key=${JSON.stringify(entryKey)} value=${JSON.stringify(val)}`,
      );
    });
    const rangeMap = parseSourceTpSlStepRangeMap(rangeMapRaw, (kind, entryKey, val) => {
      if (!this.takeSourceTpMapSkipLogSlot(kind, entryKey, val)) {
        return;
      }
      const label = kind === 'start' ? 'START' : 'RANGE';
      this.logger.warn(
        `SOURCE_TP_SL_STEP_${label}: пропущена невалидная запись key=${JSON.stringify(entryKey)} value=${JSON.stringify(val)}`,
      );
    });
    const key = String(source ?? '').trim().toLowerCase();
    let mode: TpSlStepStartMode;
    if (scopedSource?.tpSlStepStart) {
      mode = parseTpSlStepStart(scopedSource.tpSlStepStart);
    } else if (key && map[key] !== undefined) {
      mode = map[key]!;
    } else {
      const explicit = await ports.settings.get('TP_SL_STEP_START');
      if (explicit !== undefined && String(explicit).trim() !== '') {
        mode = parseTpSlStepStart(explicit);
      } else {
        const legacy = await ports.settings.get('TP_SL_STEP_ENABLED');
        mode = String(legacy ?? '').trim().toLowerCase() === 'true' ? 'tp2' : 'off';
      }
    }
    if (mode === 'off') return null;
    const startNum = tpSlStepStartToTpNumber(mode);
    const globalRangeRaw = await ports.settings.get('TP_SL_STEP_RANGE');
    const globalRangeTrim = String(globalRangeRaw ?? '').trim();
    if (globalRangeTrim === '' || parseTpSlStepRangeOptional(globalRangeRaw) !== null) {
      this.lastWarnedInvalidGlobalTpSlRange = null;
    } else if (this.lastWarnedInvalidGlobalTpSlRange !== globalRangeTrim) {
      this.lastWarnedInvalidGlobalTpSlRange = globalRangeTrim;
      this.logger.warn(
        `TP_SL_STEP_RANGE: значение не распознано ${JSON.stringify(globalRangeTrim)}, используется диапазон = номер старта (исправьте настройку)`,
      );
    }
    const globalRange = parseTpSlStepRangeOptional(globalRangeRaw);
    const sourceRange =
      scopedSource?.tpSlStepRange != null
        ? scopedSource.tpSlStepRange
        : key
          ? rangeMap[key]
          : undefined;
    const rangeNum = resolveEffectiveTpSlRange(
      startNum,
      sourceRange !== undefined ? sourceRange : globalRange,
    );
    const hasAnySourceOverride = Object.keys(map).length > 0 || Object.keys(rangeMap).length > 0;
    if (
      key &&
      hasAnySourceOverride &&
      map[key] === undefined &&
      rangeMap[key] === undefined &&
      !this.ladderSourceGlobalFallbackLogged.has(key)
    ) {
      if (this.ladderSourceGlobalFallbackLogged.size >= BYBIT_LADDER_SOURCE_FALLBACK_LOG_CAP) {
        this.ladderSourceGlobalFallbackLogged.clear();
      }
      this.ladderSourceGlobalFallbackLogged.add(key);
      this.logger.debug(
        `TP_SL_LADDER: source=${JSON.stringify(key)} нет в SOURCE_TP_SL_STEP_START/RANGE — глобальные настройки (ключи карт = нормализованный title чата / Signal.source)`,
      );
    }
    return { mode, startNum, rangeNum };
  }

  async stepStopLossIfTpFilled(client: RestClientV5, fresh: any, ports: any): Promise<void> {
    const ladder = await this.resolveTpSlLadderConfigForSignal(fresh.source, ports);
    if (!ladder) return;
    const { mode, startNum: startTpNumber, rangeNum } = ladder;
    if (startTpNumber < 1) return;

    let takeProfits: number[];
    try {
      takeProfits = JSON.parse(fresh.takeProfits) as number[];
    } catch (e) {
      this.logger.warn(`TP_SL_STEP: takeProfits JSON parse error signalId=${fresh.id}: ${formatError(e)}`);
      void this.appLog.append('warn', 'bybit', 'TP_SL_STEP: ошибка разбора takeProfits', {
        signalId: fresh.id,
        error: formatError(e),
      });
      return;
    }
    if (takeProfits.length === 0) return;
    const direction = fresh.direction === 'short' ? 'short' : 'long';
    const sorted = [...takeProfits].sort((a, b) => (direction === 'long' ? a - b : b - a));
    const symbol = normalizeTradingPair(fresh.pair);
    const { tickSize } = await ports.getLinearInstrumentFilters(client, symbol);

    let maxFilledIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      const priceStr = ports.formatPriceToTick(sorted[i]!, tickSize);
      const hasFilled = fresh.orders.some(
        (o: any) =>
          o.orderKind === 'TP' &&
          o.price !== null &&
          ports.formatPriceToTick(Number(o.price), tickSize) === priceStr &&
          ports.isFilledOrderStatus(o.status),
      );
      if (!hasFilled) break;
      maxFilledIdx = i;
    }
    if (maxFilledIdx < 0) return;
    const filledCount = maxFilledIdx + 1;
    if (filledCount < startTpNumber) return;
    const targetStep = filledCount - startTpNumber;
    if (fresh.tpSlStep >= targetStep) return;

    let posInfo;
    try {
      posInfo = await client.getPositionInfo({ category: 'linear', symbol });
    } catch (e) {
      void this.appLog.append('warn', 'bybit', 'TP_SL_STEP: getPositionInfo исключение', {
        signalId: fresh.id,
        symbol,
        error: formatError(e),
      });
      return;
    }
    if (posInfo.retCode !== 0) return;
    const posRows = (posInfo.result?.list ?? []) as Array<{
      size?: string;
      side?: string;
      positionIdx?: number;
      avgPrice?: string;
      markPrice?: string;
    }>;
    const posRow = pickPositionRowForSignalDirection(posRows, direction);
    if (!posRow) return;
    const positionIdx = (posRow.positionIdx ?? 0) as 0 | 1 | 2;

    const avgEntry = parseFloat(String(posRow.avgPrice ?? '0'));
    const tick = parseFloat(tickSize);
    const idxTp = filledCount - rangeNum - 1;
    const useBreakeven = filledCount === startTpNumber || (filledCount > startTpNumber && idxTp < 0);
    const haveAvgEntry = Number.isFinite(avgEntry) && avgEntry > 0;
    const haveTick = Number.isFinite(tick) && tick > 0;
    if (useBreakeven && !haveAvgEntry) return;
    if (!haveTick) return;

    const beSlRaw = haveAvgEntry ? (direction === 'long' ? avgEntry - tick : avgEntry + tick) : null;
    const beSl = beSlRaw !== null ? ports.snapPriceToTickNum(beSlRaw, tickSize) : null;
    let newSl: number;
    if (useBreakeven) {
      newSl = beSl!;
    } else {
      if (idxTp >= sorted.length) return;
      newSl = sorted[idxTp]!;
    }
    const markRef = parseFloat(String(posRow.markPrice ?? '0'));
    const hasValidMark = Number.isFinite(markRef) && markRef > 0;
    if (hasValidMark) {
      if (direction === 'short' && newSl <= markRef) {
        newSl = ports.snapPriceToTickNum(markRef + tick, tickSize);
      } else if (direction === 'long' && newSl >= markRef) {
        newSl = ports.snapPriceToTickNum(markRef - tick, tickSize);
      }
    }
    const weakerThanBe = beSl !== null && (direction === 'long' ? newSl < beSl : newSl > beSl);
    if (weakerThanBe) {
      void this.appLog.append('warn', 'bybit', 'TP_SL_STEP: SL был бы слабее BE — пропуск', {
        signalId: fresh.id,
        symbol,
        direction,
        filledCount,
        startTpNumber,
        rangeNum,
        targetStep,
      });
      return;
    }

    const currentSl = fresh.stopLoss;
    const newSlFormatted = parseFloat(ports.formatPriceToTick(newSl, tickSize));
    const currentSlTicked = parseFloat(ports.formatPriceToTick(currentSl, tickSize));
    const improves = direction === 'long' ? newSlFormatted > currentSlTicked : newSlFormatted < currentSlTicked;
    const tickTol = haveTick ? tick * 0.6 : 1e-8;
    const alreadyThere =
      Number.isFinite(newSlFormatted) &&
      Number.isFinite(currentSlTicked) &&
      Math.abs(newSlFormatted - currentSlTicked) <= tickTol;
    if (!improves && !alreadyThere) return;

    let slOk = true;
    let slFailReason: string | undefined;
    if (improves) {
      const slRes = await this.applyPositionStopLossFull(
        client,
        symbol,
        newSlFormatted,
        'tp_sl_step',
        positionIdx,
      );
      slOk = slRes.ok;
      slFailReason = slRes.failReason;
    }
    if (!slOk) {
      void this.appLog.append('warn', 'bybit', 'TP_SL_STEP: setTradingStop не применён', {
        signalId: fresh.id,
        symbol,
        newSl: newSlFormatted,
        bybitError: slFailReason ?? 'unknown',
      });
      return;
    }

    const nextSlDb = improves ? newSlFormatted : currentSlTicked;
    await ports.prisma.signal.update({
      where: { id: fresh.id },
      data: { stopLoss: nextSlDb, tpSlStep: targetStep },
    });
    await ports.orders.createSignalEvent(fresh.id, 'TP_SL_STEPPED', {
      filledCount,
      startTpNumber,
      rangeNum,
      tpSlMode: mode,
      step: targetStep,
      previousSl: currentSlTicked,
      newSl: newSlFormatted,
      exchangeSkipped: !improves,
    });
  }

  async placeTpSplitIfNeeded(client: RestClientV5, fresh: any, ports: any): Promise<void> {
    await ports.placeTpSplitIfNeededPort(client, fresh);
  }
}
