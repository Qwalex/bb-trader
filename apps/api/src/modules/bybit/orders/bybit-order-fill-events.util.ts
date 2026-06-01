import type { BybitOrderLifecyclePollPorts } from '../types/bybit-ports.types';
import { isFilledOrderStatus } from './bybit-order-status.util';
import { parseTakeProfitsJson } from './bybit-order-lifecycle-poll-signal.util';

export type OrderFillCompareRow = {
  id: string;
  direction?: string;
  takeProfits?: string;
  orders: Array<{
    id: string;
    orderKind: string;
    status: string | null;
    price: number | null;
    qty: number | null;
  }>;
};

function resolveTpNumber(
  price: number | null | undefined,
  takeProfits: number[],
  direction: string,
): number {
  if (price == null || !Number.isFinite(Number(price)) || takeProfits.length === 0) {
    return 1;
  }
  const sorted = [...takeProfits].sort((a, b) =>
    direction === 'short' ? b - a : a - b,
  );
  const p = Number(price);
  const tol = Math.max(1e-6, Math.abs(p) * 1e-4);
  for (let i = 0; i < sorted.length; i++) {
    if (Math.abs(sorted[i]! - p) <= tol) {
      return i + 1;
    }
  }
  return 1;
}

function averageFilledEntryPrice(
  orders: OrderFillCompareRow['orders'],
): number | null {
  const filled = orders.filter(
    (o) =>
      (o.orderKind === 'ENTRY' || o.orderKind === 'DCA') &&
      isFilledOrderStatus(o.status) &&
      o.price != null &&
      Number(o.price) > 0,
  );
  if (filled.length === 0) return null;
  const sum = filled.reduce((acc, o) => acc + Number(o.price), 0);
  return sum / filled.length;
}

/** События BYBIT_ENTRY_FILLED / BYBIT_TP_FILLED при переходе ордера в filled. */
export async function emitOrderFillEventsIfNew(
  ports: BybitOrderLifecyclePollPorts,
  before: OrderFillCompareRow,
  after: OrderFillCompareRow,
): Promise<void> {
  if (!ports.orders.createSignalEvent) return;

  const beforeById = new Map(before.orders.map((o) => [o.id, o]));
  const direction = String(after.direction ?? before.direction ?? 'long').toLowerCase();
  const takeProfits = parseTakeProfitsJson(after.takeProfits ?? before.takeProfits);

  let entryEmitted = false;
  for (const ord of after.orders) {
    const prev = beforeById.get(ord.id);
    const wasFilled = prev ? isFilledOrderStatus(prev.status) : false;
    const nowFilled = isFilledOrderStatus(ord.status);
    if (wasFilled || !nowFilled) continue;

    if (ord.orderKind === 'ENTRY' || ord.orderKind === 'DCA') {
      if (entryEmitted) continue;
      const avg = averageFilledEntryPrice(after.orders);
      await ports.orders.createSignalEvent(after.id, 'BYBIT_ENTRY_FILLED', {
        price: avg ?? ord.price,
      });
      entryEmitted = true;
      continue;
    }

    if (ord.orderKind === 'TP') {
      const tpNumber = resolveTpNumber(ord.price, takeProfits, direction);
      await ports.orders.createSignalEvent(after.id, 'BYBIT_TP_FILLED', {
        tpNumber,
        price: ord.price,
      });
    }
  }
}
