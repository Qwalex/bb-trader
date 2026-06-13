export function positionHasStopLoss(row: { stopLoss?: string } | undefined): boolean {
  const sl = row?.stopLoss;
  if (sl === undefined || sl === '') {
    return false;
  }
  const n = parseFloat(String(sl));
  return Number.isFinite(n) && n > 0;
}

export function positionHasTakeProfit(row: { takeProfit?: string } | undefined): boolean {
  const tp = row?.takeProfit;
  if (tp === undefined || tp === '') {
    return false;
  }
  const n = parseFloat(String(tp));
  return Number.isFinite(n) && n > 0;
}
