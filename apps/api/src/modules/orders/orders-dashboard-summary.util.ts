import type {
  DashboardCabinetCardDto,
  DashboardCabinetsSummaryDto,
} from './orders-dashboard-cabinets.types';

export function buildDashboardCabinetsSummary(
  items: DashboardCabinetCardDto[],
): DashboardCabinetsSummaryDto {
  const cabinetCount = items.length;
  let totalPnl = 0;
  let totalOpenSignals = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalUserbotReadsToday = 0;
  let totalSignalsPlacedToday = 0;
  let cabinetsWithSetupIssues = 0;
  let cabinetsBalancePaused = 0;
  let sumEquity = 0;
  let sumAvailable = 0;
  let equityCount = 0;
  let availableCount = 0;

  for (const c of items) {
    totalPnl += Number.isFinite(c.totalPnl) ? c.totalPnl : 0;
    totalOpenSignals += Math.max(0, c.openSignals ?? 0);
    totalWins += Math.max(0, c.wins ?? 0);
    totalLosses += Math.max(0, c.losses ?? 0);
    totalUserbotReadsToday += Math.max(0, c.userbotReadMessagesToday ?? 0);
    totalSignalsPlacedToday += Math.max(0, c.userbotSignalsPlacedToday ?? 0);
    if (Array.isArray(c.setupWarnings) && c.setupWarnings.length > 0) {
      cabinetsWithSetupIssues += 1;
    }
    if (c.balanceGuard?.paused) {
      cabinetsBalancePaused += 1;
    }
    if (c.totalBalanceUsd != null && Number.isFinite(c.totalBalanceUsd)) {
      sumEquity += c.totalBalanceUsd;
      equityCount += 1;
    }
    if (c.availableBalanceUsd != null && Number.isFinite(c.availableBalanceUsd)) {
      sumAvailable += c.availableBalanceUsd;
      availableCount += 1;
    }
  }

  const closed = totalWins + totalLosses;
  const avgWinratePercent =
    closed > 0 && Number.isFinite(totalWins) ? (totalWins / closed) * 100 : null;

  return {
    cabinetCount,
    totalPnl,
    totalOpenSignals,
    totalWins,
    totalLosses,
    avgWinratePercent,
    totalEquityUsd: equityCount > 0 ? sumEquity : null,
    totalAvailableUsd: availableCount > 0 ? sumAvailable : null,
    userbotReadsToday: totalUserbotReadsToday,
    signalsPlacedToday: totalSignalsPlacedToday,
    cabinetsWithSetupIssues,
    cabinetsBalancePaused,
  };
}
