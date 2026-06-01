import type { DashboardCabinetBalanceGuardDto } from './orders-dashboard-cabinets.types';

export function buildDashboardCabinetBalanceGuard(params: {
  minBalanceUsd: number;
  balanceUsd: number | null;
  totalBalanceUsd: number | null;
}): DashboardCabinetBalanceGuardDto | undefined {
  const minBalanceUsd = params.minBalanceUsd;
  const balanceUsd = params.balanceUsd;
  const totalBalanceUsd = params.totalBalanceUsd;
  if (balanceUsd == null || !Number.isFinite(balanceUsd)) {
    return undefined;
  }
  const paused = balanceUsd < minBalanceUsd;
  const reason = paused
    ? `Автоматическая установка ордеров приостановлена: доступный баланс ${balanceUsd.toFixed(2)}$ ниже порога ${minBalanceUsd.toFixed(2)}$`
    : undefined;
  return {
    minBalanceUsd,
    balanceUsd,
    totalBalanceUsd,
    paused,
    ...(reason ? { reason } : {}),
  };
}

export function parseMinBalanceUsdSetting(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
