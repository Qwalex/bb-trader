import type { LiveExposurePosition } from './bybit.types';

export const STALE_RECONCILE_REQUIRED_CLEAN_POLLS = 3;

/**
 * Статусы ордеров Bybit, которые считаем «ещё открытыми» (не Filled/Cancelled/Deactivated).
 */
export const OPEN_ORDER_STATUSES = new Set([
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
export function isReduceOnlyOrClosingOrder(o: {
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

/** Bybit отдаёт статус с фиксированным регистром; на всякий случай нормализуем. */
export function isFilledOrderStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'filled';
}

/**
 * Распознаём ошибки нехватки доступной маржи/баланса.
 * Пример Bybit: "ab not enough for new order".
 */
export function isInsufficientBalanceError(msg: string | null | undefined): boolean {
  const t = (msg ?? '').trim().toLowerCase();
  return (
    t.includes('ab not enough for new order') ||
    t.includes('insufficient') ||
    (t.includes('not enough') && t.includes('order'))
  );
}

/** NEW/New/Created и т.п. считаем ещё живыми ордерами. */
export function isOpenOrderStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? '').trim().toLowerCase();
  return Array.from(OPEN_ORDER_STATUSES).some(
    (s) => s.toLowerCase() === normalized,
  );
}

/**
 * Hedge: по символу две строки позиции (Buy / Sell). Берём ту, что соответствует сигналу.
 * One-way: обычно одна строка с ненулевым size.
 */
export function pickPositionRowForSignalDirection(
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
  if (matched) {
    return matched;
  }
  if (withSize.length === 1) {
    const side = String(withSize[0]?.side ?? '').toLowerCase();
    if (side === 'buy' || side === 'sell') {
      return undefined;
    }
    return withSize[0];
  }
  return withSize[0];
}

export function pickLiveExposurePositionForDirection(
  positions: LiveExposurePosition[],
  direction: 'long' | 'short',
): LiveExposurePosition | undefined {
  const wantSide = direction === 'long' ? 'buy' : 'sell';
  const matched = positions.find(
    (row) => String(row.side ?? '').trim().toLowerCase() === wantSide,
  );
  if (matched) {
    return matched;
  }
  if (positions.length === 1) {
    const only = positions[0];
    const side = String(only?.side ?? '').trim().toLowerCase();
    if (side === 'buy' || side === 'sell') {
      return undefined;
    }
    return only;
  }
  return undefined;
}

/** Пока есть живые ENTRY/DCA, TP ставить рано: позиция ещё добирается. */
export function hasOpenEntryOrders(orders: {
  orderKind: string;
  status: string | null;
}[]): boolean {
  return orders.some((o) => {
    if (o.orderKind !== 'ENTRY' && o.orderKind !== 'DCA') {
      return false;
    }
    return isOpenOrderStatus(o.status);
  });
}

/** Есть ли на строке позиции ненулевой SL. */
export function positionHasStopLoss(row: { stopLoss?: string } | undefined): boolean {
  const sl = row?.stopLoss;
  if (sl === undefined || sl === '') {
    return false;
  }
  const n = parseFloat(String(sl));
  return Number.isFinite(n) && n > 0;
}
