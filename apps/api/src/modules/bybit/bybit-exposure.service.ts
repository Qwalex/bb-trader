import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../common/format-error';
import { AppLogService } from '../app-log/app-log.service';
import { OrdersService } from '../orders/orders.service';
import { TelegramService } from '../telegram/telegram.service';

import { BybitClientService } from './bybit-client.service';
import { BybitMarketService } from './bybit-market.service';
import type {
  CloseSignalResult,
  LiveExposureItem,
  LiveExposureOrder,
  LiveExposurePosition,
  SignalExecutionDebugSnapshot,
} from './bybit.types';
import {
  isFilledOrderStatus,
  isOpenOrderStatus,
  isReduceOnlyOrClosingOrder,
  OPEN_ORDER_STATUSES,
  STALE_RECONCILE_REQUIRED_CLEAN_POLLS,
} from './bybit-order-helpers';
import { formatQtyToStep } from './bybit-qty-price.util';

@Injectable()
export class BybitExposureService {
  private readonly logger = new Logger(BybitExposureService.name);
  private readonly staleFlatPollCounts = new Map<string, number>();
  private readonly staleReconcileSuspensions = new Map<string, { count: number; reason?: string }>();

  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegram: TelegramService,
    private readonly appLog: AppLogService,
    private readonly bybitClient: BybitClientService,
    private readonly market: BybitMarketService,
  ) {}

  async wouldDuplicateActivePairDirection(
    pair: string,
    direction: 'long' | 'short',
  ): Promise<boolean> {
    const symbol = normalizeTradingPair(pair);
    const client = await this.bybitClient.getClient();
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
   * Активность на бирже по символу в заданную сторону (long=Buy, short=Sell).
   * Учитываются ненулевая позиция на этой стороне и открытые не-reduce-only ордера на этой стороне.
   */
  async hasExchangeExposureForDirection(
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
            // Для V5 нужны именно открытые ордера; openOnly=1 пропускает живые заявки.
            openOnly: 0,
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
            if (!OPEN_ORDER_STATUSES.has(o.orderStatus)) {
              continue;
            }
            if (isReduceOnlyOrClosingOrder(o)) {
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

  async getExchangeActiveOrders(
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
          // Для V5 нужны именно открытые ордера; openOnly=1 пропускает живые заявки.
          openOnly: 0,
          orderFilter,
          limit: 50,
          cursor,
        });
        if (res.retCode !== 0) {
          break;
        }
        for (const o of res.result?.list ?? []) {
          if (!isOpenOrderStatus(o.orderStatus)) {
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

  async getExchangePositions(
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

  async getLiveExposureSnapshot(workspaceId?: string | null): Promise<{
    bybitConnected: boolean;
    items: LiveExposureItem[];
  }> {
    const openSignals = await this.orders.listOpenSignals(workspaceId);
    const client = await this.bybitClient.getClient(workspaceId);
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
    workspaceId?: string | null,
  ): Promise<SignalExecutionDebugSnapshot> {
    const signal = await this.orders.getSignalWithOrders(signalId, workspaceId);
    if (!signal) {
      return {
        ok: false,
        signalId,
        bybitConnected: false,
        error: 'Сигнал не найден',
      };
    }

    const symbol = normalizeTradingPair(signal.pair);
    const client = await this.bybitClient.getClient(workspaceId);
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

  /**
   * Если история не отдаёт статус, смотрим исполнения: набрался ли объём по ордеру.
   */
  async inferFilledFromExecutions(
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
  async fetchOrderStatusFromExchange(
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
    for (const orderFilter of ['Order', 'StopOrder'] as const) {
      const filterBase = { ...base, orderFilter };
      try {
        const active = await client.getActiveOrders({
          ...filterBase,
          orderId,
          openOnly: 0,
          limit: 1,
        });
        if (active.retCode === 0 && (active.result?.list?.length ?? 0) > 0) {
          return active.result!.list![0]!.orderStatus;
        }
      } catch (e) {
        this.logger.debug(`getActiveOrders ${orderFilter} ${orderId}: ${formatError(e)}`);
      }
      try {
        const hist = await client.getHistoricOrders({
          ...filterBase,
          orderId,
          limit: 1,
        });
        if (hist.retCode === 0 && (hist.result?.list?.length ?? 0) > 0) {
          return hist.result!.list![0]!.orderStatus;
        }
      } catch (e) {
        this.logger.debug(`getHistoricOrders ${orderFilter} ${orderId}: ${formatError(e)}`);
      }
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
   * Снимает все лимитные/стоп-ордера по символу и закрывает позиции (market reduce-only),
   * затем ждёт «плоского» состояния по API.
   */
  private async flattenLinearSymbolOnExchange(
    client: RestClientV5,
    symbol: string,
  ): Promise<
    | { ok: true; cancelledOrders: number; closedPositions: number }
    | {
        ok: false;
        cancelledOrders: number;
        closedPositions: number;
        error: string;
        details: string;
        pendingExchange: boolean;
        activeOrders?: number;
        positions?: number;
      }
  > {
    const errors: string[] = [];
    let cancelledOrders = 0;
    let closedPositions = 0;
    const maxRounds = 4;
    const settleWaitMs = 1_200;

    for (let round = 1; round <= maxRounds; round += 1) {
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
              `[round ${round}] cancelAllOrders(${orderFilter}) retCode=${res.retCode} ${String(res.retMsg ?? '')}`,
            );
            continue;
          }
          cancelledOrders += res.result?.list?.length ?? 0;
        } catch (e) {
          errors.push(`[round ${round}] cancelAllOrders(${orderFilter}) ${formatError(e)}`);
        }
      }

      try {
        const positions = await this.getExchangePositions(client, symbol);
        for (const p of positions) {
          const closeSide = p.side === 'Buy' ? 'Sell' : 'Buy';
          const qty = formatQtyToStep(
            p.size,
            (await this.market.getLotStep(client, symbol)).qtyStep,
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
              `[round ${round}] submit close Market retCode=${res.retCode} ${String(res.retMsg ?? '')}`,
            );
            continue;
          }
          closedPositions += 1;
        }
      } catch (e) {
        errors.push(`[round ${round}] close positions ${formatError(e)}`);
      }

      // Даём бирже применить отмены/исполнения и проверяем состояние.
      await new Promise((resolve) => setTimeout(resolve, settleWaitMs));
      const flatState = await this.waitForSymbolToBeFlat(client, symbol, 8_000, 800);
      if (flatState.ok) {
        return { ok: true, cancelledOrders, closedPositions };
      }

      if (round < maxRounds) {
        void this.appLog.append(
          'warn',
          'bybit',
          'flatten: symbol not flat after round, retrying',
          {
            symbol,
            round,
            activeOrders: flatState.activeOrders,
            positions: flatState.positions,
          },
        );
      } else {
        return {
          ok: false,
          cancelledOrders,
          closedPositions,
          error: 'Bybit ещё не подтвердил полное закрытие ордеров/позиции',
          details: `activeOrders=${flatState.activeOrders}; positions=${flatState.positions}`,
          pendingExchange: true,
          activeOrders: flatState.activeOrders,
          positions: flatState.positions,
        };
      }
    }

    if (errors.length > 0) {
      return {
        ok: false,
        cancelledOrders,
        closedPositions,
        error: 'Не удалось полностью закрыть на Bybit',
        details: errors.join(' | '),
        pendingExchange: false,
      };
    }

    return { ok: true, cancelledOrders, closedPositions };
  }

  /**
   * Перед удалением сделки в статусе ORDERS_PLACED: отмена ордеров и закрытие позиции на Bybit.
   */
  async cleanupExchangeBeforeDeletingPlacedSignal(
    signalId: string,
    workspaceId?: string | null,
  ): Promise<CloseSignalResult> {
    const signal = await this.orders.getSignalWithOrders(signalId, workspaceId);
    if (!signal) {
      return { ok: false, error: 'Сигнал не найден' };
    }

    const symbol = normalizeTradingPair(signal.pair);
    const client = await this.bybitClient.getClient(workspaceId);
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
      if (isFilledOrderStatus(ord.status)) {
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

  async closeSignalManually(
    signalId: string,
    workspaceId?: string | null,
  ): Promise<CloseSignalResult> {
    const signal = await this.orders.getSignalWithOrders(signalId, workspaceId);
    if (!signal) {
      return { ok: false, error: 'Сигнал не найден' };
    }

    const symbol = normalizeTradingPair(signal.pair);
    const client = await this.bybitClient.getClient(workspaceId);
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
        await this.orders.createSignalEvent(signalId, 'BYBIT_CLOSE_PENDING', {
          symbol,
          activeOrders: flatResult.activeOrders,
          positions: flatResult.positions,
          cancelledOrders: flatResult.cancelledOrders,
          closedPositions: flatResult.closedPositions,
        });
        void this.appLog.append('warn', 'bybit', 'manual close pending exchange cleanup', {
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
        await this.orders.createSignalEvent(signalId, 'BYBIT_CLOSE_FAILED', {
          symbol,
          errors: errParts.length > 0 ? errParts : [flatResult.details],
          cancelledOrders: flatResult.cancelledOrders,
          closedPositions: flatResult.closedPositions,
        });
        void this.appLog.append('error', 'bybit', 'manual close failed', {
          signalId,
          symbol,
          errors: errParts,
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

    const cancelledOrders = flatResult.cancelledOrders;
    const closedPositions = flatResult.closedPositions;

    for (const ord of signal.orders) {
      if (isFilledOrderStatus(ord.status)) {
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
    await this.orders.createSignalEvent(signalId, 'BYBIT_CLOSE_SUCCESS', {
      symbol,
      cancelledOrders,
      closedPositions,
      closedAt: new Date().toISOString(),
    });

    void this.appLog.append('info', 'bybit', 'manual close success', {
      signalId,
      symbol,
      cancelledOrders,
      closedPositions,
    });
    await this.notifyApiTradeCancelled(signal, 'Отмена ордеров/позиции');

    return {
      ok: true,
      signalId,
      symbol,
      cancelledOrders,
      closedPositions,
    };
  }

  private parseNumArray(raw: string | null | undefined): number[] {
    if (!raw || typeof raw !== 'string') {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
    } catch {
      return [];
    }
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
    try {
      const res = await this.telegram.notifyApiTradeCancelled({
        signalId: signal.id,
        pair: signal.pair,
        direction: signal.direction,
        entries: this.parseNumArray(signal.entries),
        entryIsRange: signal.entryIsRange,
        stopLoss: signal.stopLoss,
        takeProfits: this.parseNumArray(signal.takeProfits),
        leverage: signal.leverage,
        orderUsd: signal.orderUsd,
        capitalPercent: signal.capitalPercent,
        source: signal.source,
        reason,
      });
      if (!res.ok) {
        this.logger.warn(
          `notifyApiTradeCancelled failed signalId=${signal.id}: ${res.error ?? 'unknown'}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `notifyApiTradeCancelled exception signalId=${signal.id}: ${formatError(e)}`,
      );
    }
  }

  /** Уведомление при авто‑закрытии ORDERS_PLACED после синхронизации с «чистой» биржей (без ручного closeSignalManually). */
  private async notifyStaleReconcileTradeCancelled(
    signalIds: string[],
    reason: string,
  ): Promise<void> {
    for (const signalId of signalIds) {
      try {
        const signal = await this.orders.getSignalWithOrders(signalId);
        if (!signal) {
          continue;
        }
        await this.notifyApiTradeCancelled(signal, reason);
      } catch (e) {
        this.logger.warn(
          `notifyStaleReconcileTradeCancelled signalId=${signalId}: ${formatError(e)}`,
        );
      }
    }
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

  /**
   * Первая фаза poll: снятие зависших ORDERS_PLACED при «чистой» бирже (состояние счётчиков в этом сервисе).
   */
  async runStaleOrdersPlacedReconciliation(client: RestClientV5): Promise<void> {
    const openSignals = await this.orders.listOpenSignals();
    const staleCandidates = openSignals.filter((sig) => sig.status === 'ORDERS_PLACED');
    const uniquePairDirections = new Map<string, { pair: string; direction: 'long' | 'short' }>();
    for (const sig of staleCandidates) {
      const symbol = normalizeTradingPair(sig.pair);
      const key = this.stalePairDirectionKey(symbol, sig.direction as 'long' | 'short');
      if (!uniquePairDirections.has(key)) {
        uniquePairDirections.set(key, {
          pair: symbol,
          direction: sig.direction as 'long' | 'short',
        });
      }
    }

    for (const existingKey of Array.from(this.staleFlatPollCounts.keys())) {
      if (!uniquePairDirections.has(existingKey)) {
        this.staleFlatPollCounts.delete(existingKey);
      }
    }

    if (uniquePairDirections.size > 0) {
      void this.appLog.append(
        'debug',
        'bybit',
        'poll: reconcile stale pass started',
        {
          staleSignals: staleCandidates.length,
          uniquePairDirections: uniquePairDirections.size,
        },
      );
    }

    for (const { pair, direction } of uniquePairDirections.values()) {
      const reconcileKey = this.stalePairDirectionKey(pair, direction);
      if (this.staleReconcileSuspensions.has(reconcileKey)) {
        this.staleFlatPollCounts.delete(reconcileKey);
        const suspension = this.staleReconcileSuspensions.get(reconcileKey);
        void this.appLog.append(
          'debug',
          'bybit',
          'poll: stale reconcile skipped because pair is suspended',
          {
            symbol: pair,
            direction,
            reason: suspension?.reason ?? null,
            lockCount: suspension?.count ?? 0,
          },
        );
        continue;
      }
      try {
        const busy = await this.hasExchangeExposureForDirection(client, pair, direction);
        if (busy) {
          this.staleFlatPollCounts.delete(reconcileKey);
          void this.appLog.append(
            'debug',
            'bybit',
            'poll: stale signal kept because exchange exposure still exists',
            {
              symbol: pair,
              direction,
            },
          );
          continue;
        }

        const cleanCount = (this.staleFlatPollCounts.get(reconcileKey) ?? 0) + 1;
        this.staleFlatPollCounts.set(reconcileKey, cleanCount);
        if (cleanCount < STALE_RECONCILE_REQUIRED_CLEAN_POLLS) {
          void this.appLog.append(
            'debug',
            'bybit',
            'poll: stale reconcile postponed until clean state repeats',
            {
              symbol: pair,
              direction,
              cleanPollsObserved: cleanCount,
              cleanPollsRequired: STALE_RECONCILE_REQUIRED_CLEAN_POLLS,
            },
          );
          continue;
        }

        const reconciledIds =
          await this.orders.reconcileStaleOpenSignalsForPairAndDirection(pair, direction);
        this.staleFlatPollCounts.delete(reconcileKey);
        if (reconciledIds.length > 0) {
          void this.appLog.append(
            'info',
            'bybit',
            'poll: автоматически сняты зависшие ORDERS_PLACED при чистой бирже',
            {
              symbol: pair,
              direction,
              signalsUpdated: reconciledIds.length,
            },
          );
          void this.notifyStaleReconcileTradeCancelled(
            reconciledIds,
            'Синхронизация с Bybit: на бирже нет ордеров/позиции, сделка закрыта в учёте',
          );
        } else {
          void this.appLog.append(
            'debug',
            'bybit',
            'poll: no stale signals found to reconcile for clean exchange side',
            {
              symbol: pair,
              direction,
            },
          );
        }
      } catch (err) {
        this.staleFlatPollCounts.delete(reconcileKey);
        void this.appLog.append(
          'warn',
          'bybit',
          'poll: failed to reconcile stale ORDERS_PLACED',
          {
            symbol: pair,
            direction,
            error: formatError(err),
          },
        );
        this.logger.warn(
          `poll reconcile stale ${pair} ${direction}: ${formatError(err)}`,
        );
      }
    }
  }

  stalePairDirectionKey(
    pair: string,
    direction: 'long' | 'short',
  ): string {
    return `${normalizeTradingPair(pair)}:${direction}`;
  }

  async clearImmediateStaleDbBlockerIfExchangeFlat(
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
    const hasDbBlocker = await this.orders.hasOrdersPlacedSignalForPairAndDirection(
      symbol,
      direction,
    );
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
