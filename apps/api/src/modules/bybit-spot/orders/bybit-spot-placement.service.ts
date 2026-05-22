import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { OrdersService } from '../../orders/orders.service';
import { formatPriceToTick, formatQtyToStep } from '../../bybit/instrument/bybit-qty.util';
import { BybitRateLimitService } from '../../bybit/instrument/bybit-rate-limit.service';
import type { PlaceOrdersResult } from '../../bybit/types/bybit.types';
import { BybitSpotInstrumentService } from '../instrument/bybit-spot-instrument.service';
import type { SpotBuyParams, SpotSellParams } from '../types/bybit-spot.types';

@Injectable()
export class BybitSpotPlacementService {
  private readonly logger = new Logger(BybitSpotPlacementService.name);

  constructor(
    private readonly instrument: BybitSpotInstrumentService,
    private readonly rateLimit: BybitRateLimitService,
    private readonly appLog: AppLogService,
    private readonly cabinetContext: CabinetContextService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
  ) {}

  async placeBuy(params: SpotBuyParams): Promise<PlaceOrdersResult> {
    const client = await this.instrument.getClient();
    if (!client) {
      return { ok: false, error: 'Не заданы ключи Bybit API' };
    }
    const signal = params.signal;
    const symbol = normalizeTradingPair(signal.pair);
    const amountUsdt = params.amountUsdt;
    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      return { ok: false, error: 'Сумма покупки должна быть больше 0 USDT' };
    }

    const filters = await this.instrument.getSpotInstrumentFilters(client, symbol);
    const entryPrice = signal.entries[0];
    const hasLimitEntry =
      typeof entryPrice === 'number' && Number.isFinite(entryPrice) && entryPrice > 0;

    let signalRow;
    try {
      signalRow = await this.orders.createSignalRecord(
        { ...signal, leverage: 1, orderUsd: amountUsdt },
        params.rawMessage,
        'PENDING',
        params.origin,
        { marketType: 'spot' },
      );
    } catch (e) {
      return { ok: false, error: formatError(e) };
    }

    const bybitIds: string[] = [];
    try {
      if (hasLimitEntry) {
        const priceStr = formatPriceToTick(entryPrice, filters.tickSize);
        const priceNum = parseFloat(priceStr);
        const qtyNum = amountUsdt / priceNum;
        const qtyStr = formatQtyToStep(qtyNum, filters.qtyStep);
        if (parseFloat(qtyStr) < parseFloat(filters.minQty)) {
          await this.orders.updateSignalStatus(signalRow.id, { status: 'FAILED' });
          return {
            ok: false,
            error: `Объём покупки ниже минимального лота ${filters.minQty} для ${symbol}`,
          };
        }
        const minNotional = parseFloat(filters.minNotionalValue);
        if (Number.isFinite(minNotional) && minNotional > 0 && amountUsdt < minNotional) {
          await this.orders.updateSignalStatus(signalRow.id, { status: 'FAILED' });
          return {
            ok: false,
            error: `Номинал ${amountUsdt.toFixed(2)} USDT ниже минимума ${minNotional} для ${symbol}`,
          };
        }
        const orderRes = await this.rateLimit.runBybitCall(() =>
          client.submitOrder({
            category: 'spot',
            symbol,
            side: 'Buy',
            orderType: 'Limit',
            qty: qtyStr,
            price: priceStr,
            timeInForce: 'GTC',
            isLeverage: 0,
            orderFilter: 'Order',
          }),
        );
        const oid = orderRes.result?.orderId;
        if (oid) {
          bybitIds.push(oid);
        }
        await this.orders.createOrderRecord({
          signalId: signalRow.id,
          bybitOrderId: oid,
          orderKind: 'ENTRY',
          side: 'Buy',
          price: priceNum,
          qty: parseFloat(qtyStr),
          status: orderRes.retCode === 0 ? 'NEW' : 'FAILED',
        });
        if (orderRes.retCode !== 0) {
          await this.orders.updateSignalStatus(signalRow.id, { status: 'FAILED' });
          return {
            ok: false,
            error: formatError(orderRes.retMsg ?? 'submitOrder failed'),
            signalId: signalRow.id,
          };
        }
      } else {
        const qtyStr = amountUsdt.toFixed(2);
        const orderRes = await this.rateLimit.runBybitCall(() =>
          client.submitOrder({
            category: 'spot',
            symbol,
            side: 'Buy',
            orderType: 'Market',
            qty: qtyStr,
            marketUnit: 'quoteCoin',
            timeInForce: 'IOC',
            isLeverage: 0,
            orderFilter: 'Order',
          }),
        );
        const oid = orderRes.result?.orderId;
        if (oid) {
          bybitIds.push(oid);
        }
        const lastPrice = await this.instrument.getSpotLastPrice(client, symbol);
        await this.orders.createOrderRecord({
          signalId: signalRow.id,
          bybitOrderId: oid,
          orderKind: 'ENTRY',
          side: 'Buy',
          ...(lastPrice != null ? { price: lastPrice } : {}),
          status: orderRes.retCode === 0 ? 'NEW' : 'FAILED',
        });
        if (orderRes.retCode !== 0) {
          await this.orders.updateSignalStatus(signalRow.id, { status: 'FAILED' });
          return {
            ok: false,
            error: formatError(orderRes.retMsg ?? 'submitOrder failed'),
            signalId: signalRow.id,
          };
        }
      }

      await this.orders.updateSignalStatus(signalRow.id, { status: 'ORDERS_PLACED' });
      void this.appLog.append('info', 'bybit', 'Spot buy order placed', {
        signalId: signalRow.id,
        symbol,
        amountUsdt,
        bybitOrderIds: bybitIds,
        cabinetId: this.cabinetContext.getCabinetId(),
      });
      return { ok: true, signalId: signalRow.id, bybitOrderIds: bybitIds };
    } catch (e) {
      this.logger.warn(`placeBuy ${symbol}: ${formatError(e)}`);
      await this.orders.updateSignalStatus(signalRow.id, { status: 'FAILED' }).catch(() => undefined);
      return { ok: false, error: formatError(e), signalId: signalRow.id };
    }
  }

  async placeSellLimit(params: SpotSellParams): Promise<PlaceOrdersResult> {
    const client = await this.instrument.getClient();
    if (!client) {
      return { ok: false, error: 'Не заданы ключи Bybit API' };
    }
    const fresh = await this.orders.getSignalWithOrders(params.signalId);
    if (!fresh || fresh.marketType !== 'spot') {
      return { ok: false, error: 'Spot-сделка не найдена' };
    }
    const symbol = normalizeTradingPair(fresh.pair);
    const baseQty = fresh.spotBaseQty ?? 0;
    if (!(baseQty > 0)) {
      return { ok: false, error: 'Нет spot-баланса для продажи' };
    }
    const percent = Math.min(Math.max(params.percent, 1), 100);
    const sellQty = (baseQty * percent) / 100;
    const filters = await this.instrument.getSpotInstrumentFilters(client, symbol);
    const qtyStr = formatQtyToStep(sellQty, filters.qtyStep);
    const qtyNum = parseFloat(qtyStr);
    if (!(qtyNum > 0)) {
      return { ok: false, error: 'Объём продажи слишком мал для биржи' };
    }
    const priceStr = formatPriceToTick(params.limitPrice, filters.tickSize);

    const orderRes = await this.rateLimit.runBybitCall(() =>
      client.submitOrder({
        category: 'spot',
        symbol,
        side: 'Sell',
        orderType: 'Limit',
        qty: qtyStr,
        price: priceStr,
        timeInForce: 'GTC',
        isLeverage: 0,
        orderFilter: 'Order',
      }),
    );
    const oid = orderRes.result?.orderId;
    await this.orders.createOrderRecord({
      signalId: fresh.id,
      bybitOrderId: oid,
      orderKind: params.levelKind === 'tp' ? 'TP' : 'SL',
      side: 'Sell',
      price: parseFloat(priceStr),
      qty: qtyNum,
      status: orderRes.retCode === 0 ? 'NEW' : 'FAILED',
    });
    if (orderRes.retCode !== 0) {
      return { ok: false, error: formatError(orderRes.retMsg ?? 'submitOrder sell failed') };
    }
    void this.appLog.append('info', 'bybit', 'Spot sell limit placed', {
      signalId: fresh.id,
      symbol,
      percent,
      qty: qtyNum,
      price: priceStr,
      levelKind: params.levelKind,
      levelIndex: params.levelIndex,
    });
    return { ok: true, signalId: fresh.id, bybitOrderIds: oid ? [oid] : [] };
  }
}
