import { Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { formatError } from '../../common/format-error';
import { AppLogService } from '../app-log/app-log.service';
import { OrdersService } from '../orders/orders.service';
import { SettingsService } from '../settings/settings.service';

export interface PlaceOrdersResult {
  ok: boolean;
  error?: string;
  signalId?: string;
  bybitOrderIds?: string[];
}

export interface LiveExposureOrder {
  orderId: string;
  side: string;
  type: string;
  status: string;
  price: number | null;
  qty: number | null;
  reduceOnly: boolean;
}

export interface LiveExposurePosition {
  side: string;
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
  positionIdx: number;
}

export interface LiveExposureItem {
  signalId: string;
  pair: string;
  direction: string;
  status: string;
  source: string | null;
  createdAt: Date;
  dbOrders: {
    id: string;
    orderKind: string;
    side: string;
    status: string | null;
    price: number | null;
    qty: number | null;
    bybitOrderId: string | null;
  }[];
  exchange: {
    activeOrders: LiveExposureOrder[];
    positions: LiveExposurePosition[];
    hasExposure: boolean;
  };
}

export interface CloseSignalResult {
  ok: boolean;
  signalId?: string;
  symbol?: string;
  cancelledOrders?: number;
  closedPositions?: number;
  error?: string;
  details?: string;
}

export interface RecalcClosedPnlResult {
  ok: boolean;
  dryRun: boolean;
  scanned: number;
  updated: number;
  unchanged: number;
  skippedNoBybitOrders: number;
  skippedNoClosedPnl: number;
  errors: { signalId: string; error: string }[];
}

export interface SignalExecutionDebugSnapshot {
  ok: boolean;
  signalId: string;
  bybitConnected: boolean;
  symbol?: string;
  signal?: {
    id: string;
    pair: string;
    direction: string;
    status: string;
    source: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  dbOrders?: {
    id: string;
    orderKind: string;
    side: string;
    status: string;
    price: number | null;
    qty: number | null;
    bybitOrderId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
  exchange?: {
    activeOrders: LiveExposureOrder[];
    positions: LiveExposurePosition[];
    bybitOrderStatuses: {
      dbOrderId: string;
      bybitOrderId: string;
      exchangeStatus?: string;
      execQty: number;
      execValue: number;
      execCount: number;
      firstExecAt?: string;
      lastExecAt?: string;
      fetchError?: string;
    }[];
  };
  error?: string;
}

@Injectable()
export class BybitService {
  private readonly logger = new Logger(BybitService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
  ) {}

  /**
   * Нормализует строковые настройки из .env/SQLite:
   * - убирает внешние пробелы;
   * - снимает парные кавычки (часто появляются после copy/paste).
   */
  private static normalizeSettingValue(
    value: string | undefined,
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const hasMatchingQuotes =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"));
    const unwrapped = hasMatchingQuotes ? trimmed.slice(1, -1).trim() : trimmed;
    return unwrapped || undefined;
  }

  /**
   * Выбирает ключи по флагу BYBIT_TESTNET:
   * — testnet: BYBIT_API_KEY_TESTNET / BYBIT_API_SECRET_TESTNET;
   * — mainnet: BYBIT_API_KEY_MAINNET / BYBIT_API_SECRET_MAINNET.
   */
  private async getBybitCredentials(): Promise<{
    key: string;
    secret: string;
    testnet: boolean;
  } | null> {
    const testnet =
      BybitService.normalizeSettingValue(
        await this.settings.get('BYBIT_TESTNET'),
      )?.toLowerCase() === 'true';
    let key: string | undefined;
    let secret: string | undefined;
    if (testnet) {
      key = BybitService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_KEY_TESTNET'),
      );
      secret = BybitService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_SECRET_TESTNET'),
      );
    } else {
      key = BybitService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_KEY_MAINNET'),
      );
      secret = BybitService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_SECRET_MAINNET'),
      );
    }
    if (!key || !secret) {
      return null;
    }
    return { key, secret, testnet };
  }

  private async getClient(): Promise<RestClientV5 | null> {
    const creds = await this.getBybitCredentials();
    if (!creds) {
      return null;
    }
    return new RestClientV5({
      key: creds.key,
      secret: creds.secret,
      testnet: creds.testnet,
    });
  }

  /** USDT balance in unified derivatives wallet (best-effort). */
  private async getUsdtBalance(client: RestClientV5): Promise<number> {
    const res = await client.getWalletBalance({
      accountType: 'UNIFIED',
    });
    const list = res.result?.list?.[0];
    const coin = list?.coin?.find((c) => c.coin === 'USDT');
    const avail = coin?.walletBalance ?? coin?.equity ?? '0';
    return parseFloat(String(avail));
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

  /** Округление количества к шагу лота (без подмешивания min на каждый кусок — это ломало split). */
  private formatQtyToStep(qty: number, qtyStep: string): string {
    const stepNum = parseFloat(qtyStep);
    if (!Number.isFinite(stepNum) || stepNum <= 0) {
      return String(qty);
    }
    const floored = Math.floor(qty / stepNum) * stepNum;
    const decimals = (qtyStep.split('.')[1] ?? '').length;
    return floored.toFixed(decimals);
  }

  /** Цена лимитки по tickSize инструмента. */
  private formatPriceToTick(price: number, tickSize: string): string {
    const tick = parseFloat(tickSize);
    if (!Number.isFinite(tick) || tick <= 0) {
      return String(price);
    }
    const rounded = Math.round(price / tick) * tick;
    const decimals = (tickSize.split('.')[1] ?? '').length;
    return rounded.toFixed(decimals);
  }

  private roundQty(qty: number, step: string, minQty: string): string {
    const stepNum = parseFloat(step);
    const min = parseFloat(minQty);
    // Входы считаем с округлением вниз, чтобы не превышать доступный бюджет/маржу.
    const roundedDown = Math.floor(qty / stepNum) * stepNum;
    const q = Math.max(roundedDown, min);
    const decimals = (step.split('.')[1] ?? '').length;
    return q.toFixed(decimals);
  }

  /** Базовая валидация направления/уровней сигнала. */
  private validateSignalLevels(signal: SignalDto): string | undefined {
    const entries = signal.entries;
    if (!entries.length) {
      return 'Не заданы входы';
    }
    const minEntry = Math.min(...entries);
    const maxEntry = Math.max(...entries);
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
    const totalUnits = Math.floor(totalQtyBase / stepNum);
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
    return outUnits.map((u) => this.formatQtyToStep(u * stepNum, qtyStep));
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
      const one = this.formatQtyToStep(totalQtyBase, qtyStep);
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
    const one = this.formatQtyToStep(totalQtyBase, qtyStep);
    return parseFloat(one) > 0 ? [one] : [];
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
        const n = await this.orders.reconcileStaleOpenSignalsForPairAndDirection(
          symbol,
          direction,
        );
        if (n > 0) {
          void this.appLog.append(
            'info',
            'bybit',
            'reconcile: по стороне биржа чиста, сняты зависшие ORDERS_PLACED в БД',
            {
              symbol,
              direction,
              signalsUpdated: n,
            },
          );
        }
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
    return matched ?? withSize[0];
  }

  /**
   * Статусы ордеров Bybit, которые считаем «ещё открытыми» (не Filled/Cancelled/Deactivated).
   */
  private static readonly OPEN_ORDER_STATUSES = new Set([
    'Created',
    'New',
    'PartiallyFilled',
    'Untriggered',
    'Triggered',
    'Active',
  ]);

  /**
   * TP/SL/трейлинг и т.п. — закрывают позицию, не считаются «входом» в противоположную сторону.
   * Bybit часто отдаёт reduceOnly как 1 или true; иногда только stopOrderType.
   */
  private static isReduceOnlyOrClosingOrder(o: {
    reduceOnly?: unknown;
    closeOnTrigger?: unknown;
    stopOrderType?: unknown;
  }): boolean {
    const ro = o.reduceOnly;
    if (
      ro === true ||
      ro === 1 ||
      ro === '1' ||
      String(ro ?? '').toLowerCase() === 'true'
    ) {
      return true;
    }
    const cot = o.closeOnTrigger;
    if (cot === true || cot === 1 || cot === '1') {
      return true;
    }
    const st = String(o.stopOrderType ?? '').toLowerCase();
    if (!st) {
      return false;
    }
    if (
      st.includes('takeprofit') ||
      st.includes('stoploss') ||
      st.includes('partialtakeprofit') ||
      st.includes('trailing') ||
      st.includes('tpsl')
    ) {
      return true;
    }
    return false;
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
    const MIN_POS = 1e-12;
    const wantBuy = direction === 'long';

    const orderFilters = ['Order', 'StopOrder'] as const;
    for (const orderFilter of orderFilters) {
      try {
        let cursor: string | undefined;
        do {
          const ao = await client.getActiveOrders({
            category: 'linear',
            symbol,
            openOnly: 1,
            limit: 50,
            orderFilter,
            cursor,
          });
          if (ao.retCode !== 0) {
            this.logger.debug(
              `getActiveOrders ${orderFilter} retCode=${ao.retCode} ${ao.retMsg}`,
            );
            break;
          }
          const list = ao.result?.list ?? [];
          for (const o of list) {
            if (!BybitService.OPEN_ORDER_STATUSES.has(o.orderStatus)) {
              continue;
            }
            if (BybitService.isReduceOnlyOrClosingOrder(o)) {
              continue;
            }
            const side = String(o.side ?? '').toLowerCase();
            const isBuy = side === 'buy';
            if (wantBuy === isBuy) {
              this.logger.debug(
                `hasExchangeExposureForDirection(${direction}): open order ${o.orderId} status=${o.orderStatus} filter=${orderFilter}`,
              );
              return true;
            }
          }
          cursor = ao.result?.nextPageCursor || undefined;
        } while (cursor);
      } catch (e) {
        this.logger.debug(
          `getActiveOrders ${orderFilter}: ${formatError(e)}`,
        );
      }
    }

    try {
      const pos = await client.getPositionInfo({
        category: 'linear',
        symbol,
      });
      if (pos.retCode === 0) {
        const rows = pos.result?.list ?? [];
        for (const row of rows) {
          const size = row?.size ? Math.abs(parseFloat(String(row.size))) : 0;
          if (size <= MIN_POS) {
            continue;
          }
          const side = String(row.side ?? '').toLowerCase();
          const isBuy = side === 'buy';
          if (wantBuy === isBuy) {
            this.logger.debug(
              `hasExchangeExposureForDirection(${direction}): position idx=${row.positionIdx} size=${row.size}`,
            );
            return true;
          }
        }
      } else {
        this.logger.debug(
          `getPositionInfo symbol=${symbol} retCode=${pos.retCode} ${pos.retMsg}`,
        );
      }
    } catch (e) {
      this.logger.debug(`getPositionInfo symbol=${symbol}: ${formatError(e)}`);
    }

    /** Fallback: скан USDT-линейных позиций (если символ в ответе отличается от ожидаемого). */
    try {
      let cursor: string | undefined;
      do {
        const pos = await client.getPositionInfo({
          category: 'linear',
          settleCoin: 'USDT',
          limit: 50,
          cursor,
        });
        if (pos.retCode !== 0) {
          break;
        }
        const rows = pos.result?.list ?? [];
        for (const row of rows) {
          if (normalizeTradingPair(row.symbol) !== symbol) {
            continue;
          }
          const size = row?.size ? Math.abs(parseFloat(String(row.size))) : 0;
          if (size <= MIN_POS) {
            continue;
          }
          const side = String(row.side ?? '').toLowerCase();
          const isBuy = side === 'buy';
          if (wantBuy === isBuy) {
            this.logger.debug(
              `hasExchangeExposureForDirection(${direction}): USDT scan match ${row.symbol} size=${row.size}`,
            );
            return true;
          }
        }
        cursor = pos.result?.nextPageCursor || undefined;
      } while (cursor);
    } catch (e) {
      this.logger.debug(`getPositionInfo settleCoin scan: ${formatError(e)}`);
    }

    return false;
  }

  private async getExchangeActiveOrders(
    client: RestClientV5,
    symbol: string,
  ): Promise<LiveExposureOrder[]> {
    const orderFilters = ['Order', 'StopOrder'] as const;
    const byId = new Map<string, LiveExposureOrder>();

    for (const orderFilter of orderFilters) {
      let cursor: string | undefined;
      do {
        const res = await client.getActiveOrders({
          category: 'linear',
          symbol,
          openOnly: 1,
          orderFilter,
          limit: 50,
          cursor,
        });
        if (res.retCode !== 0) {
          break;
        }
        for (const o of res.result?.list ?? []) {
          if (!BybitService.isOpenOrderStatus(o.orderStatus)) {
            continue;
          }
          const orderId = String(o.orderId ?? '');
          if (!orderId) {
            continue;
          }
          byId.set(orderId, {
            orderId,
            side: String(o.side ?? ''),
            type: String(o.orderType ?? ''),
            status: String(o.orderStatus ?? ''),
            price:
              o.price !== undefined && o.price !== ''
                ? Number(o.price)
                : null,
            qty: o.qty !== undefined && o.qty !== '' ? Number(o.qty) : null,
            reduceOnly: Boolean(o.reduceOnly),
          });
        }
        cursor = res.result?.nextPageCursor || undefined;
      } while (cursor);
    }

    return Array.from(byId.values());
  }

  private async getExchangePositions(
    client: RestClientV5,
    symbol: string,
  ): Promise<LiveExposurePosition[]> {
    const res = await client.getPositionInfo({
      category: 'linear',
      symbol,
    });
    if (res.retCode !== 0) {
      return [];
    }
    const out: LiveExposurePosition[] = [];
    for (const row of res.result?.list ?? []) {
      const size = row?.size ? Math.abs(parseFloat(String(row.size))) : 0;
      if (!Number.isFinite(size) || size <= 1e-12) {
        continue;
      }
      out.push({
        side: String(row.side ?? ''),
        size,
        entryPrice:
          row.avgPrice !== undefined && row.avgPrice !== ''
            ? Number(row.avgPrice)
            : null,
        markPrice:
          row.markPrice !== undefined && row.markPrice !== ''
            ? Number(row.markPrice)
            : null,
        unrealizedPnl:
          row.unrealisedPnl !== undefined && row.unrealisedPnl !== ''
            ? Number(row.unrealisedPnl)
            : null,
        positionIdx: Number(row.positionIdx ?? 0),
      });
    }
    return out;
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

    return { bybitConnected, items };
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

  async closeSignalManually(signalId: string): Promise<CloseSignalResult> {
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

    const errors: string[] = [];
    let cancelledOrders = 0;
    let closedPositions = 0;

    const orderFilters = ['Order', 'StopOrder'] as const;
    for (const orderFilter of orderFilters) {
      try {
        const res = await client.cancelAllOrders({
          category: 'linear',
          symbol,
          orderFilter,
        });
        if (res.retCode !== 0) {
          errors.push(
            `cancelAllOrders(${orderFilter}) retCode=${res.retCode} ${String(res.retMsg ?? '')}`,
          );
          continue;
        }
        cancelledOrders += res.result?.list?.length ?? 0;
      } catch (e) {
        errors.push(`cancelAllOrders(${orderFilter}) ${formatError(e)}`);
      }
    }

    try {
      const positions = await this.getExchangePositions(client, symbol);
      for (const p of positions) {
        const closeSide = p.side === 'Buy' ? 'Sell' : 'Buy';
        const qty = this.formatQtyToStep(
          p.size,
          (await this.getLotStep(client, symbol)).qtyStep,
        );
        if (!qty || parseFloat(qty) <= 0) {
          continue;
        }
        const res = await client.submitOrder({
          category: 'linear',
          symbol,
          side: closeSide,
          orderType: 'Market',
          qty,
          reduceOnly: true,
          closeOnTrigger: true,
          positionIdx: (p.positionIdx as 0 | 1 | 2) ?? 0,
        });
        if (res.retCode !== 0) {
          errors.push(
            `submit close Market retCode=${res.retCode} ${String(res.retMsg ?? '')}`,
          );
          continue;
        }
        closedPositions += 1;
      }
    } catch (e) {
      errors.push(`close positions ${formatError(e)}`);
    }

    if (errors.length > 0) {
      void this.appLog.append(
        'error',
        'bybit',
        'manual close failed',
        {
          signalId,
          symbol,
          errors,
        },
      );
      return {
        ok: false,
        signalId,
        symbol,
        cancelledOrders,
        closedPositions,
        error: 'Не удалось полностью закрыть на Bybit',
        details: errors.join(' | '),
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

    await this.orders.updateSignalStatus(signalId, {
      status: 'CLOSED_MIXED',
      closedAt: new Date(),
      realizedPnl: null,
    });

    void this.appLog.append('info', 'bybit', 'manual close success', {
      signalId,
      symbol,
      cancelledOrders,
      closedPositions,
    });

    return {
      ok: true,
      signalId,
      symbol,
      cancelledOrders,
      closedPositions,
    };
  }

  async placeSignalOrders(
    signal: SignalDto,
    rawMessage: string | undefined,
  ): Promise<PlaceOrdersResult> {
    const symbol = normalizeTradingPair(signal.pair);

    const testnetMode =
      (await this.settings.get('BYBIT_TESTNET')) === 'true';
    const client = await this.getClient();
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

    try {
      if (
        await this.hasExchangeExposureForDirection(
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
      const reconciled =
        await this.orders.reconcileStaleOpenSignalsForPairAndDirection(
          symbol,
          signal.direction,
        );
      if (reconciled > 0) {
        void this.appLog.append('info', 'bybit', 'placeSignalOrders: reconcile зависших ORDERS_PLACED', {
          symbol,
          direction: signal.direction,
          signalsUpdated: reconciled,
        });
      }
    } catch (e) {
      const msg = formatError(e);
      this.logger.warn(`Exchange activity check failed: ${msg}`);
      if (
        await this.orders.hasActiveSignalForPairAndDirection(
          signal.pair,
          signal.direction,
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

    const side: 'Buy' | 'Sell' = signal.direction === 'long' ? 'Buy' : 'Sell';

    try {
      const validationErr = this.validateSignalLevels(signal);
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
      const balance = await this.getUsdtBalance(client);
      const DEFAULT_ORDER_USD = 10;
      const minCapitalRaw = await this.settings.get('MIN_CAPITAL_AMOUNT');
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
        leveragedNotional = DEFAULT_ORDER_USD;
      }
      await client.setLeverage({
        category: 'linear',
        symbol,
        buyLeverage: String(signal.leverage),
        sellLeverage: String(signal.leverage),
      });

      const { qtyStep, minQty } = await this.getLotStep(client, symbol);
      const lastPrice = await this.getLastPrice(client, symbol);
      if (!lastPrice) {
        void this.appLog.append('warn', 'bybit', 'placeSignalOrders: last price unavailable, fallback to limit entries', {
          symbol,
        });
      }
      const minQtyNum = parseFloat(minQty);
      const requestedEntries = signal.entries;
      let effectiveEntries = requestedEntries;
      let weights = this.entryNotionalWeights(effectiveEntries.length);

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

      const signalRow = await this.orders.createSignalRecord(
        {
          ...signal,
          entries: effectiveEntries,
        },
        rawMessage,
        'ORDERS_PLACED',
      );

      const bybitIds: string[] = [];
      /**
       * Только входы. TP — отдельные reduce-only лимитки после исполнения всех входов
       * (по одному ордеру на каждый уровень TP, позиция делится поровну).
       */

      for (let i = 0; i < effectiveEntries.length; i++) {
        const price = effectiveEntries[i]!;
        const share = weights[i] ?? 1 / effectiveEntries.length;
        const notionalSlice = leveragedNotional * share;
        const qtyNum = notionalSlice / price;
        const qty = this.roundQty(qtyNum, qtyStep, minQty);
        const shouldUseStop =
          lastPrice !== undefined
            ? signal.direction === 'short'
              ? price <= lastPrice
              : price >= lastPrice
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
          const insufficient = BybitService.isInsufficientBalanceError(errText);

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
    return Array.from(BybitService.OPEN_ORDER_STATUSES).some(
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

  /** Есть ли уже исполненный вход (ENTRY/DCA). */
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
      return BybitService.isFilledOrderStatus(o.status);
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

  /** Есть ли на строке позиции ненулевой SL. */
  private static positionHasStopLoss(row: { stopLoss?: string } | undefined): boolean {
    const sl = row?.stopLoss;
    if (sl === undefined || sl === '') {
      return false;
    }
    const n = parseFloat(String(sl));
    return Number.isFinite(n) && n > 0;
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
        openOnly: 1,
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
    const mainRow = BybitService.pickPositionRowForSignalDirection(rows, dir);
    if (!mainRow) {
      return;
    }
    const posSize = mainRow?.size
      ? Math.abs(parseFloat(String(mainRow.size)))
      : 0;
    if (posSize <= 1e-12) {
      return;
    }

    if (BybitService.positionHasStopLoss(mainRow)) {
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

    for (const o of entryOrders) {
      if (!o.bybitOrderId) {
        continue;
      }
      const st = await this.fetchOrderStatusFromExchange(
        client,
        s.pair,
        o.bybitOrderId,
        o.qty != null ? Number(o.qty) : undefined,
      );
      if (st && st !== o.status) {
        await this.orders.updateOrder(o.id, {
          status: st,
          filledAt: BybitService.isFilledOrderStatus(st) ? new Date() : undefined,
        });
      }
    }

    const s2 = await this.orders.getSignalWithOrders(fresh.id);
    if (!s2) {
      return;
    }

    // Если ещё нет ни одного исполненного входа, TP/SL ставить рано.
    if (!this.hasFilledEntryOrders(s2.orders)) {
      this.logger.debug(
        `placeTpSplitIfNeeded: skip ${normalizeTradingPair(s2.pair)} — no filled entries yet`,
      );
      return;
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
      BybitService.pickPositionRowForSignalDirection(rows, dir);
    if (!rowWithPos) {
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
      await this.getLinearInstrumentFilters(client, symbol);

    await this.applyPositionStopLossFull(
      client,
      symbol,
      s2.stopLoss,
      'tp_one_per_level',
      positionIdx,
    );

    const tpChildrenPerLevel = 1;

    let n = takeProfits.length;
    let qtyParts: string[] = [];
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

    const activeTpPrices = takeProfits.slice(0, Math.max(n, 0));

    let totalTpPlaced = 0;

    if (qtyParts.length === 0) {
      void this.appLog.append('warn', 'bybit', 'placeTpSplit: не удалось разбить позицию по уровням TP', {
        symbol,
        posSize,
        tpLevelsRequested: takeProfits.length,
      });
      return;
    }
    if (n < takeProfits.length) {
      void this.appLog.append('warn', 'bybit', 'placeTpSplit: число TP уменьшено из-за minQty лота', {
        symbol,
        posSize,
        requestedLevels: takeProfits.length,
        usedLevels: n,
      });
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
      const p = this.formatPriceToTick(Number(o.price), tickSize);
      if (BybitService.isOpenOrderStatus(o.status)) {
        liveTpByPrice.set(p, (liveTpByPrice.get(p) ?? 0) + 1);
      } else if (BybitService.isFilledOrderStatus(o.status)) {
        filledTpByPrice.set(p, (filledTpByPrice.get(p) ?? 0) + 1);
      }
    }

    for (let ti = 0; ti < activeTpPrices.length; ti++) {
      const tpPrice = activeTpPrices[ti]!;
      const levelQtyStr = qtyParts[ti];
      if (!levelQtyStr || parseFloat(levelQtyStr) <= 0) {
        return;
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
      const priceStr = this.formatPriceToTick(tpPrice, tickSize);
      const existingAtPrice = liveTpByPrice.get(priceStr) ?? 0;
      const alreadyFilledAtPrice = filledTpByPrice.get(priceStr) ?? 0;
      const targetAtPrice = Math.max(0, childQtyParts.length - alreadyFilledAtPrice);
      let missingAtPrice = Math.max(0, targetAtPrice - existingAtPrice);
      if (missingAtPrice <= 0) {
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
  }

  /** orderId в строке getClosedPnL — для привязки PnL к нашим ордерам, а не к list[0] для всех. */
  private static extractClosedPnlOrderId(row: unknown): string {
    if (!row || typeof row !== 'object') {
      return '';
    }
    const r = row as Record<string, unknown>;
    const v = r.orderId ?? r.orderID;
    return v != null && String(v).length > 0 ? String(v) : '';
  }

  /** В разных эндпоинтах Bybit время приходит в разных полях/форматах. */
  private static extractClosedPnlTimestampMs(
    row: unknown,
  ): number | undefined {
    if (!row || typeof row !== 'object') {
      return undefined;
    }
    const r = row as Record<string, unknown>;
    const raw =
      r.createdTime ??
      r.updatedTime ??
      r.execTime ??
      r.createdAt ??
      r.updatedAt;
    if (raw == null || String(raw).trim() === '') {
      return undefined;
    }
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber;
    }
    const parsed = Date.parse(String(raw));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
    signalCreatedAt: Date,
  ): { totalPnl: number; hadParsedPnl: boolean } {
    const createdAtMs = signalCreatedAt.getTime();
    const createdFloorMs = createdAtMs - 60_000;

    const parsedRows = rows.map((row) => {
      const orderId = BybitService.extractClosedPnlOrderId(row);
      const ts = BybitService.extractClosedPnlTimestampMs(row);
      const cp = (row as { closedPnl?: unknown }).closedPnl;
      const pnl =
        cp != null && String(cp).trim() !== ''
          ? Number.parseFloat(String(cp))
          : Number.NaN;
      return { orderId, ts, pnl };
    });

    const hasTrackedRows = parsedRows.some(
      (r) => r.orderId.length > 0 && ourIds.has(r.orderId),
    );

    const candidates = parsedRows.filter((r) => {
      if (r.orderId.length > 0 && ourIds.has(r.orderId)) {
        return true;
      }
      if (!hasTrackedRows) {
        return false;
      }
      return r.ts !== undefined && r.ts >= createdFloorMs;
    });

    let totalPnl = 0;
    let hadParsedPnl = false;
    for (const row of candidates) {
      if (!Number.isFinite(row.pnl)) {
        continue;
      }
      totalPnl += row.pnl;
      hadParsedPnl = true;
    }

    return { totalPnl, hadParsedPnl };
  }

  private async fetchClosedPnlRowsForSymbol(
    client: RestClientV5,
    symbol: string,
    createdAt: Date,
  ): Promise<unknown[]> {
    const createdFloorMs = createdAt.getTime() - 60_000;
    const rows: unknown[] = [];
    let cursor: string | undefined;
    const MAX_PAGES = 20;

    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await client.getClosedPnL({
        category: 'linear',
        symbol,
        limit: 50,
        cursor,
      });
      if (res.retCode !== 0) {
        break;
      }

      const list = res.result?.list ?? [];
      rows.push(...list);
      cursor = res.result?.nextPageCursor || undefined;

      if (!cursor || list.length === 0) {
        break;
      }

      const oldestInPage = list.reduce<number | undefined>((acc, row) => {
        const ts = BybitService.extractClosedPnlTimestampMs(row);
        if (ts === undefined) {
          return acc;
        }
        return acc === undefined ? ts : Math.min(acc, ts);
      }, undefined);

      if (oldestInPage !== undefined && oldestInPage < createdFloorMs) {
        break;
      }
    }

    return rows;
  }

  async recalcClosedSignalsPnl(params?: {
    limit?: number;
    dryRun?: boolean;
  }): Promise<RecalcClosedPnlResult> {
    const dryRun = params?.dryRun ?? true;
    const limit = params?.limit ?? 200;
    const client = await this.getClient();
    if (!client) {
      return {
        ok: false,
        dryRun,
        scanned: 0,
        updated: 0,
        unchanged: 0,
        skippedNoBybitOrders: 0,
        skippedNoClosedPnl: 0,
        errors: [
          {
            signalId: '-',
            error:
              'Нет подключенных ключей Bybit. Пересчет closed PnL невозможен.',
          },
        ],
      };
    }

    const closed = await this.orders.listClosedSignalsForPnlRecalc({ limit });
    let updated = 0;
    let unchanged = 0;
    let skippedNoBybitOrders = 0;
    let skippedNoClosedPnl = 0;
    const errors: { signalId: string; error: string }[] = [];

    for (const sig of closed) {
      const ourIds = new Set<string>(
        sig.orders
          .map((o) => (o.bybitOrderId ? String(o.bybitOrderId) : ''))
          .filter((id): id is string => id.length > 0),
      );
      if (ourIds.size === 0) {
        skippedNoBybitOrders += 1;
        continue;
      }

      try {
        const symbol = normalizeTradingPair(sig.pair);
        const rows = await this.fetchClosedPnlRowsForSymbol(
          client,
          symbol,
          sig.createdAt,
        );
        const { totalPnl, hadParsedPnl } = this.sumClosedPnlForSignal(
          rows,
          ourIds,
          sig.createdAt,
        );

        if (!hadParsedPnl) {
          skippedNoClosedPnl += 1;
          continue;
        }

        const nextStatus = totalPnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS';
        const prevPnl = sig.realizedPnl;
        const pnlChanged =
          prevPnl === null ||
          prevPnl === undefined ||
          Math.abs(prevPnl - totalPnl) > 1e-9;
        const statusChanged = sig.status !== nextStatus;

        if (!pnlChanged && !statusChanged) {
          unchanged += 1;
          continue;
        }

        if (!dryRun) {
          await this.orders.updateSignalStatus(sig.id, {
            status: nextStatus,
            realizedPnl: totalPnl,
            closedAt: sig.closedAt ?? new Date(),
          });
        }
        updated += 1;
      } catch (e) {
        errors.push({ signalId: sig.id, error: formatError(e) });
      }
    }

    if (!dryRun) {
      void this.appLog.append(
        'info',
        'bybit',
        'recalc closed pnl completed',
        {
          scanned: closed.length,
          updated,
          unchanged,
          skippedNoBybitOrders,
          skippedNoClosedPnl,
          errors: errors.length,
        },
      );
    }

    return {
      ok: errors.length === 0,
      dryRun,
      scanned: closed.length,
      updated,
      unchanged,
      skippedNoBybitOrders,
      skippedNoClosedPnl,
      errors,
    };
  }

  async pollOpenOrders(): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      return;
    }

    const openSignals = await this.orders.listOpenSignals();
    for (const sig of openSignals) {
      for (const ord of sig.orders) {
        if (!ord.bybitOrderId) continue;
        try {
          const st = await this.fetchOrderStatusFromExchange(
            client,
            sig.pair,
            ord.bybitOrderId,
            ord.qty != null ? Number(ord.qty) : undefined,
          );
          if (st) {
            await this.orders.updateOrder(ord.id, {
              status: st,
              filledAt: BybitService.isFilledOrderStatus(st)
                ? new Date()
                : undefined,
            });
          }
        } catch (err) {
          this.logger.debug(`poll order ${ord.bybitOrderId}: ${String(err)}`);
        }
      }

      const fresh = await this.orders.getSignalWithOrders(sig.id);
      if (!fresh) continue;

      try {
        await this.ensureStopLossForMultiTpOpenPosition(client, fresh);
      } catch (e) {
        this.logger.warn(
          `ensureStopLossForMultiTpOpenPosition: ${formatError(e)}`,
        );
      }

      try {
        await this.placeTpSplitIfNeeded(client, fresh);
      } catch (e) {
        this.logger.warn(`placeTpSplitIfNeeded: ${formatError(e)}`);
      }

      try {
        const symNorm = normalizeTradingPair(fresh.pair);
        const pos = await client.getPositionInfo({
          category: 'linear',
          symbol: symNorm,
        });
        const size = pos.result?.list?.[0]?.size;
        const posSize = size ? Math.abs(parseFloat(size)) : 0;
        const hadFill = fresh.orders.some((o) =>
          BybitService.isFilledOrderStatus(o.status),
        );
        if (hadFill && posSize === 0 && fresh.status === 'ORDERS_PLACED') {
          const ourIds = new Set<string>(
            fresh.orders
              .map((o) => (o.bybitOrderId ? String(o.bybitOrderId) : ''))
              .filter((id): id is string => id.length > 0),
          );
          const pnlRes = await client.getClosedPnL({
            category: 'linear',
            symbol: symNorm,
            limit: 50,
          });
          const rows = pnlRes.result?.list ?? [];
          const { totalPnl, hadParsedPnl } = this.sumClosedPnlForSignal(
            rows,
            ourIds,
            fresh.createdAt,
          );
          if (hadParsedPnl) {
            await this.orders.updateSignalStatus(fresh.id, {
              status: totalPnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS',
              realizedPnl: totalPnl,
              closedAt: new Date(),
            });
          } else if (ourIds.size > 0) {
            const sibling =
              await this.orders.findOlderClosedSiblingAfterNewerCreated(
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
              });
              void this.appLog.append(
                'info',
                'bybit',
                'poll: дубликат сигнала без orderId в closed PnL — CLOSED_MIXED',
                {
                  signalId: fresh.id,
                  pair: symNorm,
                  siblingId: sibling.id,
                },
              );
            }
          }
        }
      } catch (err) {
        this.logger.debug(`poll position ${fresh.pair}: ${String(err)}`);
      }
    }
  }
}
