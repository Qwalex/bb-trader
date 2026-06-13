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
import { splitPositionQtyForTps } from '../instrument/bybit-qty.util';
import { hasLiveTpOrders, hasOpenEntryOrders } from '../orders/bybit-order-status.util';
import { pickPositionRowForSignalDirection } from '../position/bybit-position-pick.util';
import { positionHasStopLoss } from './bybit-tpsl.util';
import type { BybitTpSplitPlacementPorts } from './bybit-tp-split-ports.types';
import { BybitRateLimitService } from '../instrument/bybit-rate-limit.service';

@Injectable()
export class BybitTpSlService {
  private readonly logger = new Logger(BybitTpSlService.name);
  private lastWarnedInvalidGlobalTpSlRange: string | null = null;
  private readonly ladderSourceGlobalFallbackLogged = new Set<string>();
  private readonly sourceTpMapSkipLogged = new Set<string>();

  constructor(
    private readonly appLog: AppLogService,
    private readonly rateLimit: BybitRateLimitService,
  ) {}

  async applyPositionStopLossFull(
    client: RestClientV5,
    symbol: string,
    stopLoss: number,
    context: string,
    positionIdx: 0 | 1 | 2 = 0,
  ): Promise<{ ok: boolean; failReason?: string }> {
    return this.applyPositionStopLossFullCore(client, symbol, stopLoss, context, positionIdx);
  }

  private async applyPositionStopLossFullCore(
    client: RestClientV5,
    symbol: string,
    stopLoss: number,
    context: string,
    positionIdx: 0 | 1 | 2 = 0,
  ): Promise<{ ok: boolean; failReason?: string }> {
    try {
      try {
        const pos = await this.rateLimit.runBybitCall(() =>
          client.getPositionInfo({
            category: 'linear',
            symbol,
          }),
        );
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
      } catch (e) {
        if (this.rateLimit.isRateLimitError(e)) {
          throw e;
        }
        // ignore non-rate-limit pre-check errors
      }

      const res = await this.rateLimit.runBybitCall(() =>
        client.setTradingStop({
          category: 'linear',
          symbol,
          positionIdx,
          tpslMode: 'Full',
          stopLoss: String(stopLoss),
          slTriggerBy: 'LastPrice',
          slOrderType: 'Market',
        }),
      );
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
      if (this.rateLimit.isRateLimitError(e)) {
        throw e;
      }
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

  /**
   * Ставит SL на позицию (setTradingStop Full), пока нет активных TP-ордеров:
   * после исполнения входов, до/параллельно с выставлением reduce-only TP.
   * Ранее выполнялось только при takeProfits.length > 1 — из-за этого один TP и SL не проставлялись.
   * «Живые» TP считаем через {@link hasLiveTpOrders} (FAILED/Cancelled в БД не блокируют повтор SL).
   */
  async ensureStopLossForMultiTpOpenPosition(
    client: RestClientV5,
    sig: {
      id: string;
      pair: string;
      direction: string;
      stopLoss: number;
      orders: { orderKind: string; status: string | null }[];
    },
    helpers: {
      pickPositionRowForSignalDirection: (
        rows: Array<{ size?: string; side?: string; positionIdx?: number; stopLoss?: string }>,
        direction: 'long' | 'short',
      ) => { size?: string; side?: string; positionIdx?: number; stopLoss?: string } | undefined;
    },
  ): Promise<void> {
    if (!Number.isFinite(sig.stopLoss) || sig.stopLoss <= 0) {
      return;
    }
    if (hasLiveTpOrders(sig.orders)) {
      return;
    }

    const symbol = normalizeTradingPair(sig.pair);
    const posRes = await this.rateLimit.runBybitCall(() =>
      client.getPositionInfo({ category: 'linear', symbol }),
    );
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
    await this.applyPositionStopLossFull(
      client,
      symbol,
      sig.stopLoss,
      'multi_tp_early',
      positionIdx,
    );
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
      posInfo = await this.rateLimit.runBybitCall(() =>
        client.getPositionInfo({ category: 'linear', symbol }),
      );
    } catch (e) {
      if (this.rateLimit.isRateLimitError(e)) {
        throw e;
      }
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
    const improves =
      direction === 'long' ? newSlFormatted > currentSlTicked : newSlFormatted < currentSlTicked;
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

  /**
   * Reduce-only лимитки TP после исполнения входов (по одному на уровень, деление qty).
   * Ранее порт был заглушкой — без этого шага на бирже оставался только SL.
   */
  async placeTpSplitIfNeeded(
    client: RestClientV5,
    fresh: {
      id: string;
      pair: string;
      direction: string;
      status?: string;
      takeProfits: string;
      orders: { orderKind: string; status: string | null }[];
    },
    ports: BybitTpSplitPlacementPorts,
  ): Promise<void> {
    const activeStatuses = new Set(['ORDERS_PLACED', 'OPEN', 'PARSED']);
    if (!activeStatuses.has(String(fresh.status ?? ''))) {
      return;
    }
    let takeProfits: number[];
    try {
      takeProfits = JSON.parse(fresh.takeProfits) as number[];
    } catch (e) {
      this.logger.warn(
        `placeTpSplitIfNeeded: takeProfits JSON parse error signalId=${fresh.id}: ${formatError(e)}`,
      );
      return;
    }
    if (!Array.isArray(takeProfits) || takeProfits.length === 0) {
      return;
    }
    const direction = fresh.direction === 'short' ? 'short' : 'long';
    const sortedRaw = [...takeProfits].filter((p) => Number.isFinite(p) && p > 0);
    if (sortedRaw.length === 0) {
      return;
    }
    const symbol = normalizeTradingPair(fresh.pair);
    const { qtyStep, minQty, tickSize } = await ports.getLinearInstrumentFilters(client, symbol);

    const seenTick = new Set<string>();
    const sorted: number[] = [];
    const ordered = sortedRaw.sort((a, b) => (direction === 'long' ? a - b : b - a));
    for (const p of ordered) {
      const ticked = ports.formatPriceToTick(p, tickSize);
      if (seenTick.has(ticked)) {
        continue;
      }
      seenTick.add(ticked);
      sorted.push(parseFloat(ticked));
    }
    if (sorted.length === 0) {
      return;
    }

    const posResEarly = await this.rateLimit.runBybitCall(() =>
      client.getPositionInfo({ category: 'linear', symbol }),
    );
    let posSizeEarly = 0;
    if (posResEarly.retCode === 0) {
      const posRowEarly = pickPositionRowForSignalDirection(
        posResEarly.result?.list ?? [],
        direction,
      );
      posSizeEarly = posRowEarly?.size ? Math.abs(parseFloat(String(posRowEarly.size))) : 0;
    }

    if (hasOpenEntryOrders(fresh.orders) && !(posSizeEarly > 1e-12)) {
      return;
    }
    if (hasOpenEntryOrders(fresh.orders) && posSizeEarly > 1e-12) {
      void this.appLog.append(
        'info',
        'bybit',
        'placeTpSplit: позиция на бирже есть — ставим TP несмотря на «открытый» entry в БД',
        { signalId: fresh.id, symbol, direction, posSize: posSizeEarly },
      );
    }

    const deadTp = new Set(['cancelled', 'rejected', 'failed', 'deactivated']);
    const hasLiveTp = fresh.orders.some((o) => {
      if (o.orderKind !== 'TP') {
        return false;
      }
      const s = (o.status ?? '').trim().toLowerCase();
      if (!s) {
        return false;
      }
      return !deadTp.has(s);
    });
    if (hasLiveTp) {
      return;
    }

    const posRes = await this.rateLimit.runBybitCall(() =>
      client.getPositionInfo({ category: 'linear', symbol }),
    );
    if (posRes.retCode !== 0) {
      return;
    }
    const rows = posRes.result?.list ?? [];
    const posRow = pickPositionRowForSignalDirection(rows, direction);
    if (!posRow) {
      return;
    }
    const posSize = posRow.size ? Math.abs(parseFloat(String(posRow.size))) : 0;
    if (!(posSize > 1e-12)) {
      return;
    }

    const closeSide: 'Buy' | 'Sell' = direction === 'long' ? 'Sell' : 'Buy';
    const positionIdx = await ports.resolveEntryPositionIdx(client, symbol, closeSide);

    let levelCount = sorted.length;
    let qtyParts: string[] = [];
    let pricesSlice: number[] = [];
    while (levelCount >= 1) {
      pricesSlice = sorted.slice(0, levelCount);
      qtyParts = splitPositionQtyForTps({
        totalQtyBase: posSize,
        tpCount: levelCount,
        qtyStep,
        minQty,
      });
      if (qtyParts.length === levelCount && qtyParts.every((q) => parseFloat(q) > 0)) {
        break;
      }
      levelCount -= 1;
    }
    if (levelCount < 1 || qtyParts.length === 0) {
      const diag = ports.buildTpSplitDiagnostics({
        posSize,
        requestedLevels: sorted.length,
        qtyStep,
        minQty,
      });
      void this.appLog.append('warn', 'bybit', 'placeTpSplit: не удалось разбить qty по TP', {
        signalId: fresh.id,
        symbol,
        direction,
        posSizeRounded: diag.posSizeRounded,
        reasons: diag.reasons,
      });
      return;
    }
    if (levelCount < sorted.length) {
      void this.appLog.append('info', 'bybit', 'placeTpSplit: число TP уменьшено из-за minQty лота', {
        signalId: fresh.id,
        symbol,
        requested: sorted.length,
        used: levelCount,
      });
    }

    const placedIds: string[] = [];
    const errors: string[] = [];
    for (let i = 0; i < levelCount; i += 1) {
      const price = pricesSlice[i]!;
      const qtyStr = qtyParts[i]!;
      const priceStr = ports.formatPriceToTick(price, tickSize);
      try {
        const orderRes = await this.rateLimit.runBybitCall(() =>
          client.submitOrder({
            category: 'linear',
            symbol,
            side: closeSide,
            orderType: 'Limit',
            qty: qtyStr,
            price: priceStr,
            timeInForce: 'GTC',
            reduceOnly: true,
            positionIdx,
          }),
        );
        const oid = orderRes.result?.orderId ? String(orderRes.result.orderId) : undefined;
        if (orderRes.retCode === 0 && oid) {
          placedIds.push(oid);
          await ports.orders.createOrderRecord({
            signalId: fresh.id,
            bybitOrderId: oid,
            orderKind: 'TP',
            side: closeSide,
            price: parseFloat(priceStr),
            qty: parseFloat(qtyStr),
            status: 'NEW',
          });
        } else {
          const msg = `${orderRes.retCode} ${String(orderRes.retMsg ?? '')}`.trim();
          errors.push(`TP#${i + 1}: ${msg}`);
          void this.appLog.append('warn', 'bybit', 'placeTpSplit: submitOrder TP отклонён', {
            signalId: fresh.id,
            symbol,
            tpIndex: i + 1,
            retCode: orderRes.retCode,
            retMsg: String(orderRes.retMsg ?? ''),
          });
          const retMsgLower = String(orderRes.retMsg ?? '').toLowerCase();
          if (orderRes.retCode === 110017 || retMsgLower.includes('truncated to zero')) {
            break;
          }
        }
      } catch (e) {
        const msg = formatError(e);
        errors.push(`TP#${i + 1}: ${msg}`);
        void this.appLog.append('warn', 'bybit', 'placeTpSplit: submitOrder TP исключение', {
          signalId: fresh.id,
          symbol,
          tpIndex: i + 1,
          error: msg,
        });
      }
    }

    if (placedIds.length > 0) {
      await ports.orders.createSignalEvent(fresh.id, 'BYBIT_TP_LIMITS_PLACED', {
        symbol,
        direction,
        bybitOrderIds: placedIds,
        levels: levelCount,
        errors: errors.length > 0 ? errors : undefined,
      });
    }
  }
}
