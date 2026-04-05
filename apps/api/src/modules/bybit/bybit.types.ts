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

export interface RecalcClosedPnlJobStatus {
  jobId: string;
  workspaceId?: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  dryRun: boolean;
  limit: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: RecalcClosedPnlResult;
  error?: string;
}

export interface TradePnlBreakdownResult {
  ok: boolean;
  signalId: string;
  source: 'closed_pnl' | 'execution_fallback' | 'unavailable';
  requestWindow: {
    startTime: number;
    endTime: number;
  };
  finalPnl: number | null;
  grossPnl: number | null;
  fees: {
    openFee: number | null;
    closeFee: number | null;
    execFee: number | null;
    total: number | null;
  };
  details?: string;
  error?: string;
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
