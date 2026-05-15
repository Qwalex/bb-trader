import type { BalanceAlertRuleRow, Row } from './settings.types';

export type CabinetOverviewCabinetItem = {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
};

export type CabinetOverviewCardData = {
  cabinet: CabinetOverviewCabinetItem;
  settings: Row[];
  balanceAlerts: BalanceAlertRuleRow[];
  error: string | null;
};

export type CabinetListResponse = {
  items?: CabinetOverviewCabinetItem[];
};

export type SettingsEffectiveResponse = {
  settings?: Row[];
};

export type BalanceAlertsResponse = {
  items?: BalanceAlertRuleRow[];
};
