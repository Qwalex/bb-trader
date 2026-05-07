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
  totalBalanceUsd: number | null;
  availableBalanceUsd: number | null;
};

export type ConnectedGroupItem = {
  chatId: string;
  title: string;
  username: string | null;
};
