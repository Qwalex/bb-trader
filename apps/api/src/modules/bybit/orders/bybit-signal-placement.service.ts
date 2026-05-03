import { Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import type { ActiveSignalTradeSnapshot } from '../../orders/orders-active-signal-snapshot.types';
import { BybitRateLimitService } from '../instrument/bybit-rate-limit.service';
import type { BybitSignalPlacementPorts } from '../types/bybit-ports.types';
import type { PlaceOrdersResult, SignalOrderOrigin } from '../types/bybit.types';

@Injectable()
export class BybitSignalPlacementService {
  private readonly logger = new Logger(BybitSignalPlacementService.name);

  constructor(private readonly rateLimit: BybitRateLimitService) {}

  private async cancelCreatedEntryOrders(
    client: RestClientV5,
    symbol: string,
    orderIds: string[],
  ): Promise<{ cancelledOrderIds: string[]; failedOrderIds: string[]; errors: string[] }> {
    const cancelledOrderIds: string[] = [];
    const failedOrderIds: string[] = [];
    const errors: string[] = [];
    const uniqueIds = Array.from(new Set(orderIds.map((id) => id.trim()).filter(Boolean)));
    for (const orderId of uniqueIds) {
      let cancelled = false;
      for (const orderFilter of ['Order', 'StopOrder'] as const) {
        try {
          const res = await this.rateLimit.runBybitCall(() =>
            client.cancelOrder({
              category: 'linear',
              symbol,
              orderId,
              orderFilter,
            }),
          );
          if (res.retCode === 0 || res.retCode === 110008 || res.retCode === 110001) {
            cancelled = true;
            if (res.retCode === 0) {
              cancelledOrderIds.push(orderId);
            }
            break;
          }
          if (orderFilter === 'StopOrder') {
            errors.push(
              `cancelOrder(${orderId}) retCode=${res.retCode} ${String(res.retMsg ?? '')}`,
            );
          }
        } catch (e) {
          if (orderFilter === 'StopOrder') {
            errors.push(`cancelOrder(${orderId}) ${formatError(e)}`);
          }
        }
      }
      if (!cancelled) {
        failedOrderIds.push(orderId);
      }
    }
    return { cancelledOrderIds, failedOrderIds, errors };
  }

  private async finalizeFailedPlacement(params: {
    signalId: string;
    error: string;
    stage: string;
    symbol: string;
    client: RestClientV5;
    bybitOrderIds: string[];
    ports: BybitSignalPlacementPorts;
  }): Promise<PlaceOrdersResult> {
    const { signalId, error, stage, symbol, client, bybitOrderIds, ports } = params;
    const createdIds = Array.from(new Set(bybitOrderIds));
    if (createdIds.length === 0) {
      await ports.orders.updateSignalStatus(signalId, { status: 'FAILED' });
      await ports.orders.createSignalEvent(signalId, 'BYBIT_PLACEMENT_FAILED', {
        stage,
        error,
      });
      return { ok: false, error, signalId };
    }

    const rollback = await this.cancelCreatedEntryOrders(client, symbol, createdIds);
    const payload = {
      stage,
      error,
      createdOrderIds: createdIds,
      cancelledOrderIds: rollback.cancelledOrderIds,
      failedOrderIds: rollback.failedOrderIds,
      rollbackErrors: rollback.errors,
    };

    if (rollback.failedOrderIds.length === 0) {
      await ports.orders.updateSignalStatus(signalId, { status: 'FAILED' });
      await ports.orders.createSignalEvent(signalId, 'BYBIT_PLACEMENT_ROLLBACK_OK', payload);
      void ports.appLog.append('warn', 'bybit', 'placement failed, rollback successful', {
        signalId,
        symbol,
        ...payload,
      });
      return { ok: false, error, signalId };
    }

    await ports.orders.updateSignalStatus(signalId, { status: 'ORDERS_PLACED' });
    await ports.orders.createSignalEvent(signalId, 'BYBIT_PLACEMENT_RECONCILE_REQUIRED', payload);
    void ports.appLog.append('error', 'bybit', 'placement failed, reconcile required', {
      signalId,
      symbol,
      ...payload,
    });
    const reconcileError = `${error} (часть ордеров уже размещена на бирже; запущен reconcile через статус ORDERS_PLACED)`;
    return { ok: false, error: reconcileError, signalId, bybitOrderIds: createdIds };
  }

  async placeSignalOrders(
    signal: SignalDto,
    rawMessage: string | undefined,
    origin: SignalOrderOrigin | undefined,
    ports: BybitSignalPlacementPorts,
  ): Promise<PlaceOrdersResult> {
    signal = await ports.applySourceMartingaleSizing(signal);
    signal = await ports.applyForcedLeverage(signal, origin);
    const symbol = normalizeTradingPair(signal.pair);

    const testnetMode = (await ports.settings.get('BYBIT_TESTNET')) === 'true';
    const client: RestClientV5 | null = await ports.getClient();
    if (!client) {
      void ports.appLog.append('error', 'bybit', 'placeSignalOrders: нет ключей API', {
        mode: testnetMode ? 'testnet' : 'mainnet',
      });
      return {
        ok: false,
        error: testnetMode
          ? 'Не заданы ключи Bybit для testnet (BYBIT_API_KEY_TESTNET / BYBIT_API_SECRET_TESTNET).'
          : 'Не заданы ключи Bybit для основного счёта (BYBIT_API_KEY_MAINNET / BYBIT_API_SECRET_MAINNET).',
      };
    }

    const oppositeDirection: 'long' | 'short' =
      signal.direction === 'long' ? 'short' : 'long';
    let hedgeModeActive = false;
    let oppositeOnExchangeBusy = false;

    try {
      hedgeModeActive = await ports.isHedgeModeActiveForSymbol(client, symbol);
      oppositeOnExchangeBusy = await ports.hasExchangeExposureForDirection(
        client,
        symbol,
        oppositeDirection,
      );
      if (!hedgeModeActive && oppositeOnExchangeBusy) {
        void ports.appLog.append(
          'warn',
          'bybit',
          'placeSignalOrders: отказ (противоположная позиция/ордера на бирже)',
          { symbol, direction: signal.direction, oppositeDirection, hedgeModeActive },
        );
        return {
          ok: false,
          error: `По ${symbol} уже есть позиция или входные ордера ${oppositeDirection.toUpperCase()}. Новый ${signal.direction.toUpperCase()} может закрыть существующую позицию, поэтому вход заблокирован.`,
        };
      }
      if (await ports.hasExchangeExposureForDirection(client, symbol, signal.direction)) {
        void ports.appLog.append(
          'warn',
          'bybit',
          'placeSignalOrders: отказ (ордера/позиция на бирже по этой стороне)',
          { symbol, direction: signal.direction },
        );
        return {
          ok: false,
          error: `На Bybit по ${symbol} уже есть открытые ордера или позиция по стороне ${signal.direction.toUpperCase()}. Повторный вход в ту же сторону недоступен.`,
        };
      }
      await ports.clearImmediateStaleDbBlockerIfExchangeFlat(
        symbol,
        signal.direction,
        client,
        'place-before-db-check',
      );
    } catch (e) {
      const msg = formatError(e);
      this.logger.warn(`Exchange activity check failed: ${msg}`);
      if (await ports.orders.hasActiveSignalForPairAndDirection(signal.pair, signal.direction)) {
        void ports.appLog.append(
          'warn',
          'bybit',
          'placeSignalOrders: отказ (БД: ORDERS_PLACED, проверка биржи не удалась)',
          { symbol, direction: signal.direction },
        );
        return {
          ok: false,
          error: `По паре ${symbol} уже есть активный сигнал ${signal.direction.toUpperCase()} (ордера в работе). Дождитесь закрытия сделки.`,
        };
      }
    }

    if (await ports.orders.hasActiveSignalForPairAndDirection(signal.pair, signal.direction)) {
      void ports.appLog.append('warn', 'bybit', 'placeSignalOrders: отказ (активный сигнал в БД)', {
        symbol,
        direction: signal.direction,
      });
      return {
        ok: false,
        error: `По паре ${symbol} уже есть активный сигнал ${signal.direction.toUpperCase()} (ордера в работе). Дождитесь закрытия сделки.`,
      };
    }

    let oppositeSideDbSnapshot: ActiveSignalTradeSnapshot | null = null;
    try {
      oppositeSideDbSnapshot =
        await ports.orders.findActiveSignalTradeSnapshotForPairAndDirection(
          signal.pair,
          oppositeDirection,
        );
    } catch (e) {
      this.logger.warn(
        `placeSignalOrders: снимок противоположной сделки в БД: ${formatError(e)}`,
      );
    }

    const side: 'Buy' | 'Sell' = signal.direction === 'long' ? 'Buy' : 'Sell';
    const lockKey = ports.buildPlacementLockKey(signal.pair, signal.direction);
    if (ports.placementLocks.has(lockKey)) {
      return {
        ok: false,
        error: `По паре ${symbol} уже идёт размещение ${signal.direction.toUpperCase()} сигнала. Повторите через пару секунд.`,
      };
    }
    ports.placementLocks.add(lockKey);
    let signalId: string | null = null;
    const bybitIds: string[] = [];

    try {
      const lastPrice = await ports.getLastPrice(client, symbol);
      if (!lastPrice) {
        void ports.appLog.append('warn', 'bybit', 'placeSignalOrders: last price unavailable', {
          symbol,
        });
      }
      const validationErr = ports.validateSignalLevels(signal, lastPrice);
      if (validationErr) {
        void ports.appLog.append('warn', 'bybit', 'placeSignalOrders: signal validation failed', {
          symbol,
          direction: signal.direction,
          entries: signal.entries,
          stopLoss: signal.stopLoss,
          takeProfits: signal.takeProfits,
          validationErr,
        });
        return {
          ok: false,
          error: validationErr,
          errorCode: 'signal_levels_validation',
        };
      }

      void ports.appLog.append('info', 'bybit', 'placeSignalOrders: старт', {
        symbol,
        side,
        entries: signal.entries.length,
        takeProfits: signal.takeProfits.length,
        orderUsd: signal.orderUsd,
        leverage: signal.leverage,
      });
      const balanceDetails = await ports.getUsdtBalanceDetails(client);
      const balance = balanceDetails.availableUsd;
      const defaultOrderUsd = await ports.settings.getDefaultOrderUsd(balanceDetails.totalUsd);
      const minCapitalRaw = await ports.settings.get('MIN_CAPITAL_AMOUNT');
      const minCapitalParsed =
        minCapitalRaw != null && minCapitalRaw.trim() !== '' ? parseFloat(minCapitalRaw) : Number.NaN;
      const minPercentNotionalUsd =
        Number.isFinite(minCapitalParsed) && minCapitalParsed > 0 ? minCapitalParsed : 5;
      let leveragedNotional: number;
      if (signal.orderUsd > 0) {
        leveragedNotional = signal.orderUsd;
      } else if (signal.capitalPercent > 0) {
        const pct = Number(signal.capitalPercent);
        if (!Number.isFinite(pct) || pct <= 0) {
          leveragedNotional = defaultOrderUsd;
        } else {
          if (pct <= 100) {
            const margin = balance * (pct / 100);
            leveragedNotional = margin * signal.leverage;
          } else {
            leveragedNotional = balance * (pct / 100);
          }
          if (leveragedNotional < minPercentNotionalUsd) {
            void ports.appLog.append(
              'warn',
              'bybit',
              'placeSignalOrders: percent sizing поднят до минимального номинала',
              {
                symbol,
                balance,
                capitalPercent: signal.capitalPercent,
                leverage: signal.leverage,
                calculatedNotional: leveragedNotional,
                minNotionalApplied: minPercentNotionalUsd,
              },
            );
            leveragedNotional = minPercentNotionalUsd;
          }
        }
      } else {
        leveragedNotional = defaultOrderUsd;
      }
      const leverageRes = await this.rateLimit.runBybitCall(() =>
        client.setLeverage({
          category: 'linear',
          symbol,
          buyLeverage: String(signal.leverage),
          sellLeverage: String(signal.leverage),
        }),
      );
      if (leverageRes.retCode !== 0 && leverageRes.retCode !== 110043) {
        const errText = `setLeverage failed: ${leverageRes.retCode} ${String(leverageRes.retMsg ?? '')}`;
        void ports.appLog.append('error', 'bybit', 'setLeverage отклонён', {
          symbol,
          leverage: signal.leverage,
          retCode: leverageRes.retCode,
          retMsg: String(leverageRes.retMsg ?? ''),
        });
        return { ok: false, error: errText };
      }
      if (leverageRes.retCode === 110043) {
        void ports.appLog.append('info', 'bybit', 'setLeverage: плечо уже было установлено', {
          symbol,
          leverage: signal.leverage,
          retCode: leverageRes.retCode,
        });
      }

      const { qtyStep, minQty, tickSize } = await ports.getLinearInstrumentFilters(client, symbol);
      const minQtyNum = parseFloat(minQty);
      const requestedEntries = signal.entries;
      const rangePlan = ports.applyEntryRangeResolution(signal, lastPrice, tickSize);
      if (!rangePlan.ok) {
        void ports.appLog.append('warn', 'bybit', 'placeSignalOrders: диапазон входа отклонён', {
          symbol,
          error: rangePlan.error,
        });
        return { ok: false, error: rangePlan.error };
      }
      let effectiveEntries = rangePlan.effectiveEntries;
      let weights = rangePlan.weights;

      if (effectiveEntries.length > 1) {
        const hasInsufficientSlice = effectiveEntries.some((price: number, i: number) => {
          const share = weights[i] ?? 1 / effectiveEntries.length;
          const notionalSlice = leveragedNotional * share;
          const qtyRaw = notionalSlice / price;
          return !Number.isFinite(qtyRaw) || qtyRaw < minQtyNum;
        });
        if (hasInsufficientSlice) {
          const [firstEntry] = effectiveEntries;
          if (firstEntry == null) {
            return { ok: false, error: 'Не удалось определить первую цену входа' };
          }
          effectiveEntries = [firstEntry];
          weights = [1];
          void ports.appLog.append(
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

      const bumpToMin = await ports.resolveBumpToMinExchangeLot(origin?.chatId);
      const minQtyErr = ports.validateLeveragedNotionalVsMinQty({
        leveragedNotional,
        effectiveEntries,
        weights,
        lastPrice,
        minQtyNum,
        symbol,
      });
      if (minQtyErr) {
        if (bumpToMin) {
          void ports.appLog.append(
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
          void ports.appLog.append(
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

      const signalToStore: SignalDto = { ...signal, entries: effectiveEntries };
      const signalRow = await ports.orders.createSignalRecord(
        signalToStore,
        rawMessage,
        'PENDING',
        origin,
      );
      signalId = signalRow.id;
      const entryPositionIdx = await ports.resolveEntryPositionIdx(client, symbol, side);

      if (effectiveEntries.length === 0) {
        if (!lastPrice) {
          return this.finalizeFailedPlacement({
            signalId: signalRow.id,
            error: 'Не удалось получить текущую цену для рыночного входа',
            stage: 'market-entry-last-price',
            symbol,
            client,
            bybitOrderIds: bybitIds,
            ports,
          });
        }
        const qtyNum = leveragedNotional / lastPrice;
        const qty = ports.roundQty(qtyNum, qtyStep, minQty);
        const orderRes = await this.rateLimit.runBybitCall(() =>
          client.submitOrder({
            category: 'linear',
            symbol,
            side,
            orderType: 'Market',
            qty,
            positionIdx: entryPositionIdx,
          }),
        );
        const oid = orderRes.result?.orderId;
        if (oid) bybitIds.push(oid);
        await ports.orders.createOrderRecord({
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
          void ports.appLog.append('error', 'bybit', 'submitOrder Market отклонён', {
            symbol,
            retCode: orderRes.retCode,
            retMsg: errText,
          });
          return this.finalizeFailedPlacement({
            signalId: signalRow.id,
            error: errText,
            stage: 'market-entry-submit',
            symbol,
            client,
            bybitOrderIds: bybitIds,
            ports,
          });
        }
      } else {
        for (let i = 0; i < effectiveEntries.length; i++) {
          const price = effectiveEntries[i]!;
          const share = weights[i] ?? 1 / effectiveEntries.length;
          const notionalSlice = leveragedNotional * share;
          const qtyNum = notionalSlice / price;
          const qty = ports.roundQty(qtyNum, qtyStep, minQty);
          const shouldUseStop =
            lastPrice !== undefined
              ? signal.direction === 'short'
                ? ports.snapPriceToTickNum(price, tickSize) < ports.snapPriceToTickNum(lastPrice, tickSize)
                : ports.snapPriceToTickNum(price, tickSize) > ports.snapPriceToTickNum(lastPrice, tickSize)
              : false;

          const orderReq = {
            category: 'linear' as const,
            symbol,
            side,
            orderType: 'Limit' as const,
            qty,
            price: String(price),
            timeInForce: 'GTC' as const,
            positionIdx: entryPositionIdx as 0 | 1 | 2,
            ...(shouldUseStop
              ? {
                  orderFilter: 'StopOrder' as const,
                  triggerPrice: String(price),
                  triggerBy: 'LastPrice' as const,
                  triggerDirection: (signal.direction === 'short' ? 2 : 1) as 1 | 2,
                }
              : {}),
          };

          const orderRes = await this.rateLimit.runBybitCall(() => client.submitOrder(orderReq));
          const oid = orderRes.result?.orderId;
          if (oid) bybitIds.push(oid);
          await ports.orders.createOrderRecord({
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
            const insufficient = ports.isInsufficientBalanceError(errText);
            if (isDca && insufficient) {
              this.logger.warn(`DCA skipped due to insufficient balance ${symbol} index=${i}: ${errText}`);
              void ports.appLog.append('warn', 'bybit', 'DCA пропущен: недостаточно маржи/баланса', {
                symbol,
                signalId: signalRow.id,
                entryIndex: i,
                retCode: orderRes.retCode,
                retMsg: errText,
              });
              continue;
            }

            void ports.appLog.append('error', 'bybit', 'submitOrder отклонён', {
              symbol,
              entryIndex: i,
              retCode: orderRes.retCode,
              retMsg: errText,
            });
            return this.finalizeFailedPlacement({
              signalId: signalRow.id,
              error: errText,
              stage: `limit-entry-submit-${i}`,
              symbol,
              client,
              bybitOrderIds: bybitIds,
              ports,
            });
          }
        }
      }
      await ports.orders.updateSignalStatus(signalRow.id, { status: 'ORDERS_PLACED' });
      void ports.appLog.append('info', 'bybit', 'placeSignalOrders: успех', {
        symbol,
        signalId: signalRow.id,
        bybitOrderIds: bybitIds,
      });
      if (hedgeModeActive && (oppositeOnExchangeBusy || oppositeSideDbSnapshot)) {
        const auditPayload = {
          symbol,
          hedgeModeActive,
          oppositeOnExchange: oppositeOnExchangeBusy,
          oppositeDbSignalId: oppositeSideDbSnapshot?.id ?? null,
          newSignalId: signalRow.id,
          newDirection: signal.direction,
          existingDirection: oppositeDirection,
        };
        void ports.appLog.append('info', 'bybit', 'placeSignalOrders: hedge opposite-side audit', auditPayload);
        this.logger.log(
          `placeSignalOrders hedge audit symbol=${symbol} new=${signalRow.id} oppositeDb=${oppositeSideDbSnapshot?.id ?? 'none'} oppositeExchange=${oppositeOnExchangeBusy}`,
        );
        void ports.orders.createSignalEvent(
          signalRow.id,
          'BYBIT_HEDGE_OPPOSITE_PLACEMENT_AUDIT',
          auditPayload,
        );
        void ports.notifyHedgeOppositePlacementAudit({
          symbol,
          hedgeModeActive,
          oppositeOnExchange: oppositeOnExchangeBusy,
          oppositeSideDb: oppositeSideDbSnapshot,
          newSignalId: signalRow.id,
          newSignalDto: signalToStore,
        });
      }
      return { ok: true, signalId: signalRow.id, bybitOrderIds: bybitIds };
    } catch (e) {
      const msg = formatError(e);
      this.logger.error(`placeSignalOrders: ${msg}`);
      void ports.appLog.append('error', 'bybit', 'placeSignalOrders: исключение', {
        symbol,
        signalId,
        error: msg,
      });
      if (signalId) {
        return this.finalizeFailedPlacement({
          signalId,
          error: msg,
          stage: 'unexpected-exception',
          symbol,
          client,
          bybitOrderIds: bybitIds,
          ports,
        });
      }
      return { ok: false, error: msg };
    } finally {
      ports.placementLocks.delete(lockKey);
    }
  }
}
