import { normalizeTradingPair } from '@repo/shared';

export function stalePairDirectionKey(
  pair: string,
  direction: 'long' | 'short',
): string {
  return `${normalizeTradingPair(pair)}:${direction}`;
}

export function isReduceOnlyOrClosingOrder(o: {
  reduceOnly?: unknown;
  closeOnTrigger?: unknown;
  stopOrderType?: unknown;
}): boolean {
  const ro = o.reduceOnly;
  if (ro === true || ro === 1 || ro === '1' || String(ro ?? '').toLowerCase() === 'true') {
    return true;
  }
  const cot = o.closeOnTrigger;
  if (cot === true || cot === 1 || cot === '1') {
    return true;
  }
  const st = String(o.stopOrderType ?? '').toLowerCase();
  if (!st) return false;
  return (
    st.includes('takeprofit') ||
    st.includes('stoploss') ||
    st.includes('partialtakeprofit') ||
    st.includes('trailing') ||
    st.includes('tpsl')
  );
}
