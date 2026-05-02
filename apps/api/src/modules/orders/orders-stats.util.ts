/** Чистые хелперы статистики сделок / источников (без DI). */

export function computeWinratePercent(wins: number, losses: number): number {
  const total = wins + losses;
  return total === 0 ? 0 : (wins / total) * 100;
}

export function isClosedLossOutcome(
  status: string,
  realizedPnl: number | null,
): boolean {
  return status === 'CLOSED_LOSS' || (typeof realizedPnl === 'number' && realizedPnl < 0);
}
