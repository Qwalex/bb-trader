export type Row = { key: string; value: string };

export type PendingChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};

/** Ответ API `GET /bybit/balance-alerts` (правило уведомления по equity USDT). */
export type BalanceAlertRuleRow = {
  id: string;
  cabinetId: string;
  operator: 'gt' | 'lt';
  thresholdUsd: number;
  enabled: boolean;
  lastSatisfied: boolean | null;
  createdAt: string;
  updatedAt: string;
};
