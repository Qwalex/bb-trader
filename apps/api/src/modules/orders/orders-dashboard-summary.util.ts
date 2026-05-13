import type {
  DashboardCabinetCardDto,
  DashboardCabinetsSummaryDto,
} from './orders-dashboard-cabinets.types';
import { computeCrossCabinetYieldFields } from './orders-dashboard-cross-cabinet-yield.util';

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
  let aggregateExpectedPnlPerDayUsd = 0;
  let aggregateStatsPeriodDaysMax = 0;

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
    const spd = Math.max(0, c.statsPeriodDays ?? 0);
    if (spd > aggregateStatsPeriodDaysMax) {
      aggregateStatsPeriodDaysMax = spd;
    }
    const wr = Number.isFinite(c.winrate) ? c.winrate : 0;
    const ap = Number.isFinite(c.avgProfitPnl) ? c.avgProfitPnl : 0;
    const al = Number.isFinite(c.avgLossPnl) ? c.avgLossPnl : 0;
    const cpd = Number.isFinite(c.closedPerDayAvg) ? c.closedPerDayAvg : 0;
    const ev = (wr / 100) * ap + (1 - wr / 100) * al;
    const expDay = cpd * ev;
    if (Number.isFinite(expDay)) {
      aggregateExpectedPnlPerDayUsd += expDay;
    }
  }

  const closed = totalWins + totalLosses;
  const avgWinratePercent =
    closed > 0 && Number.isFinite(totalWins) ? (totalWins / closed) * 100 : null;

  const maxDays =
    aggregateStatsPeriodDaysMax > 0 ? aggregateStatsPeriodDaysMax : null;
  const aggregateRealizedPnlPerDayUsd =
    maxDays != null && maxDays > 0 && Number.isFinite(totalPnl) ? totalPnl / maxDays : null;

  const totalEquityUsd = equityCount > 0 ? sumEquity : null;
  const aggregateExpectedPnlPerDayUsdNorm =
    cabinetCount > 0 && Number.isFinite(aggregateExpectedPnlPerDayUsd)
      ? aggregateExpectedPnlPerDayUsd
      : null;

  const yieldFields = computeCrossCabinetYieldFields({
    totalPnl,
    totalEquityUsd,
    aggregateStatsPeriodDaysMax: maxDays,
    aggregateExpectedPnlPerDayUsd: aggregateExpectedPnlPerDayUsdNorm,
  });

  return {
    cabinetCount,
    totalPnl,
    totalOpenSignals,
    totalWins,
    totalLosses,
    avgWinratePercent,
    totalEquityUsd,
    totalAvailableUsd: availableCount > 0 ? sumAvailable : null,
    userbotReadsToday: totalUserbotReadsToday,
    signalsPlacedToday: totalSignalsPlacedToday,
    cabinetsWithSetupIssues,
    cabinetsBalancePaused,
    aggregateExpectedPnlPerDayUsd: aggregateExpectedPnlPerDayUsdNorm,
    aggregateStatsPeriodDaysMax: maxDays,
    aggregateRealizedPnlPerDayUsd,
    ...yieldFields,
  };
}
