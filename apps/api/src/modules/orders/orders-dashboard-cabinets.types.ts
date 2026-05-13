/** Снимок guard доступного USDT для автоторговли из userbot (как в GET telegram-userbot/status). */
export type DashboardCabinetBalanceGuardDto = {
  minBalanceUsd: number;
  balanceUsd: number | null;
  totalBalanceUsd: number | null;
  paused: boolean;
  reason?: string;
};

export type DashboardCabinetCardDto = {
  cabinetId: string;
  slug: string;
  name: string;
  isDefault: boolean;
  openSignals: number;
  userbotReadMessagesToday: number;
  userbotSignalsPlacedToday: number;
  userbotConnected: boolean;
  enabledGroupsCount: number;
  setupWarnings: string[];
  wins: number;
  losses: number;
  winrate: number;
  totalPnl: number;
  totalBalanceUsd: number | null;
  availableBalanceUsd: number | null;
  balanceGuard?: DashboardCabinetBalanceGuardDto;
};

export type DashboardCabinetsSummaryDto = {
  cabinetCount: number;
  totalPnl: number;
  totalOpenSignals: number;
  totalWins: number;
  totalLosses: number;
  /** Доля побед по сумме W/L по всем кабинетам (не среднее winrate карточек). */
  avgWinratePercent: number | null;
  totalEquityUsd: number | null;
  totalAvailableUsd: number | null;
  userbotReadsToday: number;
  signalsPlacedToday: number;
  cabinetsWithSetupIssues: number;
  cabinetsBalancePaused: number;
};

export type DashboardCabinetsOverviewDto = {
  items: DashboardCabinetCardDto[];
  summary: DashboardCabinetsSummaryDto;
};
