export function positionHasStopLoss(row: { stopLoss?: string } | undefined): boolean {
  const sl = row?.stopLoss;
  if (sl === undefined || sl === '') {
    return false;
  }
  const n = parseFloat(String(sl));
  return Number.isFinite(n) && n > 0;
}
