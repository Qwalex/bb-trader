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
  /** false — фоновая работа кабинета остановлена. */
  isActive: boolean;
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
  /** Как в GET /orders/stats по кабинету — для кросс-кабинетного EV и калькуляторов. */
  totalClosed: number;
  avgProfitPnl: number;
  avgLossPnl: number;
  closedPerDayAvg: number;
  statsPeriodDays: number;
  totalBalanceUsd: number | null;
  availableBalanceUsd: number | null;
  balanceGuard?: DashboardCabinetBalanceGuardDto;
  /** Среднее время исполнения закрытых сигналов (createdAt → closedAt), мс. */
  avgSignalExecutionMs: number | null;
  /** Средняя длительность периода простоя (0 открытых сигналов), мс. */
  avgIdlePeriodMs: number | null;
  /** Текущая доля не задействованного баланса (available / equity), 0…1. */
  unusedBalanceRatio: number | null;
  /** Средняя доля не задействованного баланса за 30 дней, 0…1. */
  avgUnusedBalanceRatioMonth: number | null;
  /** Окно расчёта исполнения и простоя (дней). */
  utilizationPeriodDays: number;
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
  /** Σ по кабинетам: closedPerDay × EV сделки (USDT/день), модель как на главной дашборда. */
  aggregateExpectedPnlPerDayUsd: number | null;
  /**
   * max(statsPeriodDays) по карточкам — грубая нижняя оценка окна для истории;
   * totalPnl / это значение ≈ средний реализованный PnL/день по сумме кабинетов.
   */
  aggregateStatsPeriodDaysMax: number | null;
  /** totalPnl / aggregateStatsPeriodDaysMax при известном окне. */
  aggregateRealizedPnlPerDayUsd: number | null;
  /** Простая годовая: (ΣPnL ÷ Σ equity) × (365 / T), T = aggregateStatsPeriodDaysMax. */
  crossCabinetAprRealizedPercent: number | null;
  /** Сложная годовая за период T: (1 + ΣPnL/equity)^(365/T) − 1. */
  crossCabinetApyRealizedPercent: number | null;
  /** Потенциальный прирост (модель EV) за 7 дней: (1 + r)^7 − 1, r = ожид. PnL/день ÷ equity. */
  crossCabinetEvReturn7dPercent: number | null;
  crossCabinetEvReturn30dPercent: number | null;
  crossCabinetEvReturn365dPercent: number | null;
};

export type DashboardBalanceHistoryPointDto = {
  at: string;
  totalUsd: number;
};

export type DashboardCabinetsOverviewDto = {
  items: DashboardCabinetCardDto[];
  summary: DashboardCabinetsSummaryDto;
  /** Σ equity по календарным дням UTC (снимки BalanceSnapshot по всем кабинетам пользователя). */
  aggregatedBalanceHistory: DashboardBalanceHistoryPointDto[];
};
