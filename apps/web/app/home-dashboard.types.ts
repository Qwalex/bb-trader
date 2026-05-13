export type DashboardCabinetBalanceGuard = {
  minBalanceUsd: number;
  balanceUsd: number | null;
  totalBalanceUsd: number | null;
  paused: boolean;
  reason?: string;
};

export type DashboardCabinetCard = {
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
  totalClosed: number;
  avgProfitPnl: number;
  avgLossPnl: number;
  closedPerDayAvg: number;
  statsPeriodDays: number;
  totalBalanceUsd: number | null;
  availableBalanceUsd: number | null;
  balanceGuard?: DashboardCabinetBalanceGuard;
};

export type ConnectedGroupItem = {
  chatId: string;
  title: string;
  username: string | null;
};

/** Агрегаты по всем кабинетам (поле `summary` в GET /orders/dashboard-cabinets). */
export type DashboardCabinetsSummary = {
  cabinetCount: number;
  totalPnl: number;
  totalOpenSignals: number;
  totalWins: number;
  totalLosses: number;
  avgWinratePercent: number | null;
  totalEquityUsd: number | null;
  totalAvailableUsd: number | null;
  userbotReadsToday: number;
  signalsPlacedToday: number;
  cabinetsWithSetupIssues: number;
  cabinetsBalancePaused: number;
  aggregateExpectedPnlPerDayUsd: number | null;
  aggregateStatsPeriodDaysMax: number | null;
  aggregateRealizedPnlPerDayUsd: number | null;
};

export type DashboardActivityTone = 'ok' | 'warn' | 'err' | 'info';

export type DashboardActivityItem = {
  at: string;
  kind: 'ingest' | 'signal_open' | 'signal_close';
  cabinetId: string;
  cabinetName: string;
  title: string;
  subtitle?: string;
  tone: DashboardActivityTone;
};
