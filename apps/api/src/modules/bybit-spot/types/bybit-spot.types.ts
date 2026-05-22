import type { PlaceOrdersResult, SignalOrderOrigin } from '../../bybit/types/bybit.types';
import type { SignalDto } from '@repo/shared';

export type MarketAvailability = {
  linear: boolean;
  spot: boolean;
};

export type UserbotPlacementRouteResult =
  | { kind: 'linear'; placement: PlaceOrdersResult }
  | { kind: 'spot_prompt'; message?: string }
  | { kind: 'blocked'; error: string; userbotStatus?: 'place_error' | 'cancelled' };

export type SpotNotifiedState = {
  tpHit: number[];
  slHit: boolean;
};

export type RouteUserbotSignalPlacementParams = {
  signal: SignalDto;
  rawMessage?: string;
  origin?: SignalOrderOrigin;
  ingestId: string;
};

export type SpotBuyParams = {
  signal: SignalDto;
  amountUsdt: number;
  rawMessage?: string;
  origin?: SignalOrderOrigin;
};

export type SpotSellParams = {
  signalId: string;
  percent: number;
  levelKind: 'tp' | 'sl';
  levelIndex: number;
  limitPrice: number;
};

export type SpotLevelHitKind = 'tp' | 'sl';

export type BybitSpotLifecyclePollPorts = {
  getClient: () => Promise<import('bybit-api').RestClientV5 | null>;
  orders: {
    listOpenSpotSignals: () => Promise<
      Array<{
        id: string;
        pair: string;
        direction: string;
        status: string;
        stopLoss: number;
        takeProfits: string;
        spotBaseQty: number | null;
        spotNotifiedJson: string | null;
        marketType?: string | null;
        orders: Array<{
          id: string;
          bybitOrderId: string | null;
          orderKind: string;
          side: string;
          price: number | null;
          qty: number | null;
          status: string | null;
        }>;
      }>
    >;
    getSignalWithOrders: (signalId: string) => Promise<{
      id: string;
      pair: string;
      direction: string;
      status: string;
      stopLoss: number;
      takeProfits: string;
      spotBaseQty: number | null;
      spotNotifiedJson: string | null;
      marketType: string | null;
      orders: Array<{
        id: string;
        bybitOrderId: string | null;
        orderKind: string;
        side: string;
        price: number | null;
        qty: number | null;
        status: string | null;
      }>;
    } | null>;
    updateOrder: (
      id: string,
      data: {
        status?: string;
        filledAt?: Date;
        price?: number;
        qty?: number;
      },
    ) => Promise<unknown>;
    updateSignalStatus: (
      id: string,
      data: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  appLog: { append: (...args: any[]) => Promise<void> | void };
};
