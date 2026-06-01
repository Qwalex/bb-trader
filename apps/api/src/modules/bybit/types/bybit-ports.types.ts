import { RestClientV5 } from 'bybit-api';

import type { SignalDto } from '@repo/shared';

import type { ActiveSignalTradeSnapshot } from '../../orders/orders-active-signal-snapshot.types';
import type {
  CloseSignalResult,
  LiveExposurePosition,
  PlaceOrdersResult,
  SignalOrderOrigin,
} from './bybit.types';

export interface BybitSignalPlacementPorts {
  settings: {
    get: (key: string) => Promise<string | undefined>;
    getDefaultOrderUsd: (totalUsd?: number) => Promise<number>;
  };
  appLog: { append: (...args: any[]) => Promise<void> | void };
  orders: {
    hasActiveSignalForPairAndDirection: (
      pair: string,
      direction: 'long' | 'short',
    ) => Promise<boolean>;
    findActiveSignalTradeSnapshotForPairAndDirection: (
      pair: string,
      direction: 'long' | 'short',
    ) => Promise<ActiveSignalTradeSnapshot | null>;
    createSignalRecord: (...args: any[]) => Promise<any>;
    createOrderRecord: (...args: any[]) => Promise<any>;
    updateSignalStatus: (signalId: string, data: any) => Promise<any>;
    createSignalEvent: (signalId: string, type: string, payload?: unknown) => Promise<any>;
  };
  placementLocks: Set<string>;
  getClient: () => Promise<RestClientV5 | null>;
  applySourceMartingaleSizing: (signal: SignalDto) => Promise<SignalDto>;
  applyForcedLeverage: (signal: SignalDto, origin?: SignalOrderOrigin) => Promise<SignalDto>;
  hasExchangeExposureForDirection: (
    client: RestClientV5,
    symbol: string,
    direction: 'long' | 'short',
  ) => Promise<boolean>;
  isHedgeModeActiveForSymbol: (
    client: RestClientV5,
    symbol: string,
  ) => Promise<boolean>;
  clearImmediateStaleDbBlockerIfExchangeFlat: (
    pair: string,
    direction: 'long' | 'short',
    client: RestClientV5,
    reason: string,
  ) => Promise<number>;
  /** Ключ включает кабинет (см. BybitPlacementValidationService.buildPlacementLockKey). */
  buildPlacementLockKey: (pair: string, direction: 'long' | 'short') => string;
  getLastPrice: (client: RestClientV5, symbol: string) => Promise<number | undefined>;
  validateSignalLevels: (signal: SignalDto, lastPrice?: number) => string | undefined;
  getUsdtBalanceDetails: (
    client: RestClientV5,
  ) => Promise<{ totalUsd: number; availableUsd: number }>;
  getLinearInstrumentFilters: (
    client: RestClientV5,
    symbol: string,
  ) => Promise<{ qtyStep: string; minQty: string; tickSize: string }>;
  applyEntryRangeResolution: (
    signal: SignalDto,
    lastPrice: number | undefined,
    tickSize: string,
  ) => { ok: true; effectiveEntries: number[]; weights: number[] } | { ok: false; error: string };
  resolveBumpToMinExchangeLot: (chatId?: string) => Promise<boolean>;
  validateLeveragedNotionalVsMinQty: (params: any) => string | undefined;
  resolveEntryPositionIdx: (
    client: RestClientV5,
    symbol: string,
    side: 'Buy' | 'Sell',
  ) => Promise<0 | 1 | 2>;
  roundQty: (qty: number, step: string, minQty: string) => string;
  snapPriceToTickNum: (price: number, tickSize: string) => number;
  isInsufficientBalanceError: (msg: string | null | undefined) => boolean;
  notifyHedgeOppositePlacementAudit: (params: {
    symbol: string;
    hedgeModeActive: boolean;
    oppositeOnExchange: boolean;
    oppositeSideDb: ActiveSignalTradeSnapshot | null;
    newSignalId: string;
    newSignalDto: SignalDto;
  }) => void | Promise<void>;
  preflightLinearPlacement?: (
    pair: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface BybitOrderLifecyclePollPorts {
  getClient: () => Promise<RestClientV5 | null>;
  orders: {
    listOpenSignals: () => Promise<any[]>;
    reconcileStaleOpenSignalsForPairAndDirection: (
      pair: string,
      direction: 'long' | 'short',
    ) => Promise<string[]>;
    updateOrder: (orderId: string, data: any) => Promise<any>;
    getSignalWithOrders: (signalId: string) => Promise<any | null>;
    createSignalEvent?: (signalId: string, type: string, payload?: unknown) => Promise<unknown>;
  };
  stalePairDirectionKey: (pair: string, direction: 'long' | 'short') => string;
  staleFlatPollCounts: Map<string, number>;
  staleReconcileSuspensions: Map<string, { count: number; reason?: string }>;
  appLog: { append: (...args: any[]) => Promise<void> | void };
  hasExchangeExposureForDirection: (
    client: RestClientV5,
    symbol: string,
    direction: 'long' | 'short',
  ) => Promise<boolean>;
  notifyStaleReconcileTradeCancelled: (signalIds: string[], reason: string) => Promise<void> | void;
  fetchOrderStatusFromExchange: (
    client: RestClientV5,
    pair: string,
    orderId: string,
    expectedQty?: number,
  ) => Promise<string | undefined>;
  isFilledOrderStatus: (status: string | null | undefined) => boolean;
  ensureStopLossForMultiTpOpenPosition: (client: RestClientV5, fresh: any) => Promise<void>;
  placeTpSplitIfNeeded: (client: RestClientV5, fresh: any) => Promise<void>;
  stepStopLossIfTpFilled: (client: RestClientV5, fresh: any) => Promise<void>;
  finalizeSignalCloseIfNeeded: (client: RestClientV5, fresh: any) => Promise<void>;
  scheduleFastTpSlApply?: (signalId: string, reason: string) => void;
}

export interface BybitPositionClosePorts {
  normalizeTradingPair: (pair: string) => string;
  orders: {
    getSignalWithOrders: (signalId: string) => Promise<any>;
    createSignalEvent: (signalId: string, type: string, payload: any) => Promise<any>;
    updateOrder: (orderId: string, data: any) => Promise<any>;
    updateSignalStatus: (signalId: string, data: any) => Promise<any>;
  };
  getClient: () => Promise<RestClientV5 | null>;
  flattenLinearSymbolOnExchange: (client: RestClientV5, symbol: string) => Promise<any>;
  getExchangeActiveOrders: (client: RestClientV5, symbol: string) => Promise<any[]>;
  getExchangePositions: (
    client: RestClientV5,
    symbol: string,
  ) => Promise<LiveExposurePosition[]>;
  getLotStep: (client: RestClientV5, symbol: string) => Promise<{ qtyStep: string }>;
  formatQtyToStep: (qty: number, qtyStep: string) => string;
  fetchOrderStatusFromExchange: (
    client: RestClientV5,
    pair: string,
    orderId: string,
    expectedQty?: number,
  ) => Promise<string | undefined>;
  appLog: { append: (...args: any[]) => Promise<void> | void };
  isFilledOrderStatus: (status: string | null | undefined) => boolean;
  isOpenOrderStatus: (status: string | null | undefined) => boolean;
  notifyApiTradeCancelled: (signal: any, reason: string) => Promise<void>;
}

export type BybitCloseSignalFn = (
  signalId: string,
  ports: BybitPositionClosePorts,
) => Promise<CloseSignalResult>;

export type BybitPlaceOrdersFn = (
  signal: SignalDto,
  rawMessage: string | undefined,
  origin: SignalOrderOrigin | undefined,
  ports: BybitSignalPlacementPorts,
) => Promise<PlaceOrdersResult>;
