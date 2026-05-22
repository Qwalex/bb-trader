type OrderRow = {
  orderKind: string;
  side: string;
  price: number | null;
  qty: number | null;
  status: string | null;
};

function isFilled(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'filled' || s === 'partiallyfilled';
}

function orderUsdtValue(o: OrderRow): number {
  const price = o.price ?? 0;
  const qty = o.qty ?? 0;
  if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) {
    return 0;
  }
  return price * qty;
}

/** Cashflow PnL: Σ USDT sell − Σ USDT buy по filled ордерам сигнала. */
export function computeSpotRealizedPnlFromOrders(orders: OrderRow[]): number | null {
  let buyUsdt = 0;
  let sellUsdt = 0;
  let hadFill = false;
  for (const o of orders) {
    if (!isFilled(o.status)) {
      continue;
    }
    hadFill = true;
    const v = orderUsdtValue(o);
    const side = (o.side ?? '').trim().toLowerCase();
    if (side === 'buy') {
      buyUsdt += v;
    } else if (side === 'sell') {
      sellUsdt += v;
    }
  }
  if (!hadFill) {
    return null;
  }
  return sellUsdt - buyUsdt;
}
