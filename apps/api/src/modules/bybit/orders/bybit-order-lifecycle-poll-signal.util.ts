import type { RestClientV5 } from 'bybit-api';

import { formatError } from '../../../common/format-error';
import type { BybitOrderLifecyclePollPorts } from '../types/bybit-ports.types';
import {
  hasLiveTpOrders,
  hasOpenEntryOrders,
  isOpenOrderStatus,
} from './bybit-order-status.util';

export type PollSignalRow = {
  id: string;
  pair: string;
  status?: string;
  stopLoss?: number;
  takeProfits?: string;
  orders: Array<{
    id: string;
    bybitOrderId: string | null;
    orderKind: string;
    status: string | null;
    qty: number | null;
  }>;
};

/** OPEN + entries закрыты + TP уже live — не ставим TP/SL заново; статусы ордеров всё равно синхронизируем в poll (см. skipSync-ветку). */
export function shouldSkipExchangeOrderSync(sig: PollSignalRow): boolean {
  if (String(sig.status ?? '') !== 'OPEN') {
    return false;
  }
  if (hasOpenEntryOrders(sig.orders)) {
    return false;
  }
  return hasLiveTpOrders(sig.orders);
}

/** Entries filled, TP ещё нет — сразу к TP/SL без опроса entry на бирже. */
export function shouldApplyTpSlWithoutOrderSync(sig: PollSignalRow): boolean {
  if (String(sig.status ?? '') !== 'OPEN' && String(sig.status ?? '') !== 'ORDERS_PLACED') {
    return false;
  }
  if (hasOpenEntryOrders(sig.orders)) {
    return false;
  }
  return !hasLiveTpOrders(sig.orders);
}

export function parseTakeProfitsJson(raw: string | undefined | null): number[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]')) as number[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((p) => Number.isFinite(p) && p > 0);
  } catch {
    return [];
  }
}

/** Fast apply завершён: нет открытых entry и (TP не нужен или TP live). */
export function isFastTpSlApplyComplete(fresh: PollSignalRow): boolean {
  if (hasOpenEntryOrders(fresh.orders)) {
    return false;
  }
  const needsTp = parseTakeProfitsJson(fresh.takeProfits).length > 0;
  if (needsTp && !hasLiveTpOrders(fresh.orders)) {
    return false;
  }
  return true;
}

export async function syncSignalOrderStatusesFromExchange(
  ports: BybitOrderLifecyclePollPorts,
  client: RestClientV5,
  sig: PollSignalRow,
  logDebug?: (msg: string) => void,
): Promise<void> {
  for (const ord of sig.orders) {
    if (!ord.bybitOrderId) {
      continue;
    }
    if (!isOpenOrderStatus(ord.status)) {
      continue;
    }
    try {
      const st = await ports.fetchOrderStatusFromExchange(
        client,
        sig.pair,
        ord.bybitOrderId,
        ord.qty != null ? Number(ord.qty) : undefined,
      );
      if (st) {
        await ports.orders.updateOrder(ord.id, {
          status: st,
          filledAt: ports.isFilledOrderStatus(st) ? new Date() : undefined,
        });
      }
    } catch (err) {
      logDebug?.(`sync order ${ord.bybitOrderId}: ${formatError(err)}`);
    }
  }
}

export async function applyTpSlForSignal(
  ports: BybitOrderLifecyclePollPorts,
  client: RestClientV5,
  fresh: PollSignalRow,
  logWarn?: (label: string, err: unknown) => void,
): Promise<void> {
  try {
    await ports.ensureStopLossForMultiTpOpenPosition(client, fresh);
  } catch (e) {
    logWarn?.('ensureStopLossForMultiTpOpenPosition', e);
  }
  try {
    await ports.placeTpSplitIfNeeded(client, fresh);
  } catch (e) {
    logWarn?.('placeTpSplitIfNeeded', e);
  }
  try {
    await ports.stepStopLossIfTpFilled(client, fresh);
  } catch (e) {
    logWarn?.('stepStopLossIfTpFilled', e);
  }
}

export async function finalizeSignalIfNeeded(
  ports: BybitOrderLifecyclePollPorts,
  client: RestClientV5,
  fresh: PollSignalRow,
  logDebug?: (msg: string) => void,
): Promise<void> {
  try {
    await ports.finalizeSignalCloseIfNeeded(client, fresh);
  } catch (err) {
    logDebug?.(`finalize ${fresh.pair}: ${String(err)}`);
  }
}
