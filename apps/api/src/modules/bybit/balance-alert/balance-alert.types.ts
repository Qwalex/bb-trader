export const BALANCE_ALERT_OPERATORS = ['gt', 'lt'] as const;

export type BalanceAlertOperator = (typeof BALANCE_ALERT_OPERATORS)[number];

export type BalanceAlertRuleDto = {
  id: string;
  cabinetId: string;
  operator: BalanceAlertOperator;
  thresholdUsd: number;
  enabled: boolean;
  lastSatisfied: boolean | null;
  createdAt: string;
  updatedAt: string;
};
