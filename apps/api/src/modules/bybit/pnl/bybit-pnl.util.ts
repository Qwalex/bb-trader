export function buildClosedPnlWindow(
  signalCreatedAt: Date,
  signalClosedAt?: Date | null,
): { startTime: number; endTime: number } {
  const startTime = Math.max(0, signalCreatedAt.getTime());
  const rawEnd = signalClosedAt?.getTime() ?? Date.now();
  const normalizedEnd = Number.isFinite(rawEnd) ? rawEnd : startTime;
  const endTime = Math.max(startTime, normalizedEnd + 1000);
  return { startTime, endTime };
}

export function isLiquidationExecutionRow(row: Record<string, unknown>): boolean {
  const execType = String(row.execType ?? '').trim().toLowerCase();
  const createType = String(row.createType ?? '').trim().toLowerCase();
  if (execType === 'busttrade' || execType === 'adltrade') return true;
  return (
    createType === 'createbyliq' ||
    createType === 'creatbyliq' ||
    createType === 'createbyadl'
  );
}

export function isClosedPnlLiquidationRow(row: unknown): boolean {
  if (!row || typeof row !== 'object') {
    return false;
  }
  const rec = row as Record<string, unknown>;
  const execType = String(rec.execType ?? '').trim().toLowerCase();
  return execType === 'busttrade';
}
