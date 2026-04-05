import { Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../common/format-error';

import { BybitClientService } from './bybit-client.service';

@Injectable()
export class BybitMarketService {
  private readonly logger = new Logger(BybitMarketService.name);

  constructor(private readonly bybitClient: BybitClientService) {}

  /** Текущий USDT-баланс (best-effort) для внешних guard-проверок — доступные средства. */
  async getUnifiedUsdtBalance(workspaceId?: string | null): Promise<number | undefined> {
    const d = await this.getUnifiedUsdtBalanceDetails(workspaceId);
    return d?.availableUsd;
  }

  /** Доступный и суммарный (equity) USDT в unified-кошельке. */
  async getUnifiedUsdtBalanceDetails(workspaceId?: string | null): Promise<
    { availableUsd: number; totalUsd: number } | undefined
  > {
    const client = await this.bybitClient.getClient(workspaceId);
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
  async getUsdtBalanceDetails(
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

  /** Лот, мин. объём и шаг цены (для TP limit / trading-stop). */
  async getLinearInstrumentFilters(
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

  async getLotStep(
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
    const client = await this.bybitClient.getClient();
    if (!client) {
      return undefined;
    }
    const symbol = normalizeTradingPair(pair);
    return this.getLastPrice(client, symbol);
  }

  /** Последняя цена инструмента (best-effort). */
  async getLastPrice(
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
}
