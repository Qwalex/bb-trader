import type { RestClientV5 } from 'bybit-api';

import type { AppLogService } from '../../app-log/app-log.service';

/**
 * Порты для постановки reduce-only лимиток TP после исполнения входов
 * (вызывается из цикла poll open signals).
 */
export type BybitTpSplitPlacementPorts = {
  getLinearInstrumentFilters: (
    client: RestClientV5,
    symbol: string,
  ) => Promise<{ qtyStep: string; minQty: string; tickSize: string }>;
  resolveEntryPositionIdx: (
    client: RestClientV5,
    symbol: string,
    side: 'Buy' | 'Sell',
  ) => Promise<0 | 1 | 2>;
  formatPriceToTick: (price: number, tickSize: string) => string;
  buildTpSplitDiagnostics: (params: {
    posSize: number;
    requestedLevels: number;
    qtyStep: string;
    minQty: string;
  }) => {
    posSizeRounded: string;
    totalUnits: number;
    qtyStepNum: number | null;
    minQtyNum: number | null;
    reasons: string[];
  };
  orders: {
    createOrderRecord: (data: {
      signalId: string;
      bybitOrderId?: string;
      orderKind: string;
      side: string;
      price?: number;
      qty?: number;
      status: string;
    }) => Promise<unknown>;
    createSignalEvent: (signalId: string, type: string, payload?: unknown) => Promise<unknown>;
  };
  appLog: Pick<AppLogService, 'append'>;
};
