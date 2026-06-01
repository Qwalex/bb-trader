export type DashboardCabinetUtilizationMetrics = {
  /** Среднее время исполнения закрытых сигналов (createdAt → closedAt), мс. */
  avgSignalExecutionMs: number | null;
  /** Средняя длительность периода простоя (0 открытых сигналов), мс. */
  avgIdlePeriodMs: number | null;
  /** Текущая доля не задействованного баланса (available / equity), 0…1. */
  unusedBalanceRatio: number | null;
  /** Средняя доля не задействованного баланса за 30 дней по снимкам, 0…1. */
  avgUnusedBalanceRatioMonth: number | null;
  /** Окно расчёта простоя и исполнения (дней), как statsPeriodDays. */
  utilizationPeriodDays: number;
};
