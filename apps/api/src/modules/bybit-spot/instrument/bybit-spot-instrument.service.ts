import { Injectable } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { BybitClientService } from '../../bybit/instrument/bybit-client.service';
import { BybitRateLimitService } from '../../bybit/instrument/bybit-rate-limit.service';
import type { MarketAvailability } from '../types/bybit-spot.types';

export type SpotInstrumentFilters = {
  qtyStep: string;
  minQty: string;
  tickSize: string;
  minNotionalValue: string;
};

@Injectable()
export class BybitSpotInstrumentService {
  constructor(
    private readonly bybitClient: BybitClientService,
    private readonly rateLimit: BybitRateLimitService,
  ) {}

  async getClient(): Promise<RestClientV5 | null> {
    return this.bybitClient.getClient();
  }

  async resolveAvailability(pair: string): Promise<MarketAvailability> {
    const client = await this.getClient();
    const symbol = normalizeTradingPair(pair);
    if (!client) {
      return { linear: false, spot: false };
    }
    const [linearRes, spotRes] = await Promise.all([
      this.rateLimit.runBybitCall(() =>
        client.getInstrumentsInfo({ category: 'linear', symbol }),
      ),
      this.rateLimit.runBybitCall(() =>
        client.getInstrumentsInfo({ category: 'spot', symbol }),
      ),
    ]);
    const linearRow = linearRes.result?.list?.[0];
    const spotRow = spotRes.result?.list?.[0];
    const linear =
      linearRes.retCode === 0 &&
      linearRow != null &&
      String(linearRow.status ?? '').toLowerCase() === 'trading';
    const spot =
      spotRes.retCode === 0 &&
      spotRow != null &&
      String(spotRow.status ?? '').toLowerCase() === 'trading';
    return { linear, spot };
  }

  /** Early exit для linear placement: пара должна быть на linear. */
  async preflightLinearPlacement(pair: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const avail = await this.resolveAvailability(pair);
    const symbol = normalizeTradingPair(pair);
    if (!avail.linear && !avail.spot) {
      return { ok: false, error: `Пары ${symbol} нет на бирже Bybit` };
    }
    if (!avail.linear) {
      return {
        ok: false,
        error: `Пара ${symbol} доступна только на споте — используйте спот-флоу в боте`,
      };
    }
    return { ok: true };
  }

  async getSpotInstrumentFilters(
    client: RestClientV5,
    symbol: string,
  ): Promise<SpotInstrumentFilters> {
    const res = await this.rateLimit.runBybitCall(() =>
      client.getInstrumentsInfo({ category: 'spot', symbol }),
    );
    const info = res.result?.list?.[0];
    const lot = info?.lotSizeFilter;
    const price = info?.priceFilter;
    return {
      qtyStep: lot?.basePrecision ?? '0.001',
      minQty: lot?.minOrderQty ?? '0.001',
      tickSize: price?.tickSize ?? '0.0001',
      minNotionalValue: lot?.minOrderAmt ?? '0',
    };
  }

  async getSpotLastPrice(client: RestClientV5, symbol: string): Promise<number | undefined> {
    try {
      const t = await this.rateLimit.runBybitCall(() =>
        client.getTickers({ category: 'spot', symbol }),
      );
      if (t.retCode !== 0) {
        return undefined;
      }
      const row = t.result?.list?.[0];
      const v = Number(row?.lastPrice);
      return Number.isFinite(v) && v > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  }
}
