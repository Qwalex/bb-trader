export type DashboardCabinetCardDto = {
  cabinetId: string;
  slug: string;
  name: string;
  isDefault: boolean;
  openSignals: number;
  wins: number;
  losses: number;
  winrate: number;
  totalPnl: number;
  totalBalanceUsd: number | null;
  availableBalanceUsd: number | null;
};

export type DashboardCabinetsOverviewDto = {
  items: DashboardCabinetCardDto[];
};
