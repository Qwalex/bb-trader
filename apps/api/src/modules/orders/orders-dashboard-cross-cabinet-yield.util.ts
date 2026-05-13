/**
 * Доходность по сводке «все кабинеты» — те же формулы, что на главной дашборда (один кабинет),
 * с T = max(statsPeriodDays) по карточкам и equity = Σ балансов.
 */
export function computeCrossCabinetYieldFields(input: {
  totalPnl: number;
  totalEquityUsd: number | null;
  aggregateStatsPeriodDaysMax: number | null;
  aggregateExpectedPnlPerDayUsd: number | null;
}): {
  crossCabinetAprRealizedPercent: number | null;
  crossCabinetApyRealizedPercent: number | null;
  crossCabinetEvReturn7dPercent: number | null;
  crossCabinetEvReturn30dPercent: number | null;
  crossCabinetEvReturn365dPercent: number | null;
} {
  const equity = input.totalEquityUsd;
  const T =
    input.aggregateStatsPeriodDaysMax != null && input.aggregateStatsPeriodDaysMax > 0
      ? input.aggregateStatsPeriodDaysMax
      : null;

  let crossCabinetAprRealizedPercent: number | null = null;
  let crossCabinetApyRealizedPercent: number | null = null;

  if (equity != null && equity > 0 && T != null && Number.isFinite(input.totalPnl)) {
    const apr = (input.totalPnl / equity / T) * 365 * 100;
    crossCabinetAprRealizedPercent = Number.isFinite(apr) ? apr : null;

    const realizedR = input.totalPnl / equity;
    if (Number.isFinite(realizedR) && 1 + realizedR > 0 && T > 0) {
      const apy = (Math.pow(1 + realizedR, 365 / T) - 1) * 100;
      crossCabinetApyRealizedPercent = Number.isFinite(apy) ? apy : null;
    }
  }

  let crossCabinetEvReturn7dPercent: number | null = null;
  let crossCabinetEvReturn30dPercent: number | null = null;
  let crossCabinetEvReturn365dPercent: number | null = null;

  const exp = input.aggregateExpectedPnlPerDayUsd;
  if (equity != null && equity > 0 && exp != null && Number.isFinite(exp)) {
    const r = exp / equity;
    if (Number.isFinite(r) && 1 + r > 0) {
      const ev7 = (Math.pow(1 + r, 7) - 1) * 100;
      const ev30 = (Math.pow(1 + r, 30) - 1) * 100;
      const ev365 = (Math.pow(1 + r, 365) - 1) * 100;
      crossCabinetEvReturn7dPercent = Number.isFinite(ev7) ? ev7 : null;
      crossCabinetEvReturn30dPercent = Number.isFinite(ev30) ? ev30 : null;
      crossCabinetEvReturn365dPercent = Number.isFinite(ev365) ? ev365 : null;
    }
  }

  return {
    crossCabinetAprRealizedPercent,
    crossCabinetApyRealizedPercent,
    crossCabinetEvReturn7dPercent,
    crossCabinetEvReturn30dPercent,
    crossCabinetEvReturn365dPercent,
  };
}
