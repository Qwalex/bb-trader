import { BYBIT_OPEN_ORDER_STATUSES } from '../bybit.constants';

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
  return Array.from(BYBIT_OPEN_ORDER_STATUSES).some(
    (s) => s.toLowerCase() === normalized,
  );
}

/** Пока есть живые ENTRY/DCA, TP ставить рано: позиция ещё добирается. */
export function hasOpenEntryOrders(
  orders: {
    orderKind: string;
    status: string | null;
  }[],
): boolean {
  return orders.some((o) => {
    if (o.orderKind !== 'ENTRY' && o.orderKind !== 'DCA') {
      return false;
    }
    return isOpenOrderStatus(o.status);
  });
}

/** Есть ли уже исполненный вход (ENTRY/DCA). PartiallyFilled считаем достаточным для TP/SL по текущему объёму. */
export function hasFilledEntryOrders(
  orders: {
    orderKind: string;
    status: string | null;
  }[],
): boolean {
  return orders.some((o) => {
    if (o.orderKind !== 'ENTRY' && o.orderKind !== 'DCA') {
      return false;
    }
    const s = (o.status ?? '').trim().toLowerCase();
    return s === 'filled' || s === 'partiallyfilled';
  });
}

/**
 * Наличие активных TP-лимиток на бирже.
 * Важно: FAILED/Cancelled TP в БД не должны блокировать повторную постановку.
 */
export function hasLiveTpOrders(
  orders: {
    orderKind: string;
    status: string | null;
  }[],
): boolean {
  return orders.some((o) => {
    if (o.orderKind !== 'TP') {
      return false;
    }
    return isOpenOrderStatus(o.status);
  });
}
