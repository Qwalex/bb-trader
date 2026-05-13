export type DashboardActivityTone = 'ok' | 'warn' | 'err' | 'info';

export type DashboardActivityItemDto = {
  at: string;
  kind: 'ingest' | 'signal_open' | 'signal_close';
  cabinetId: string;
  cabinetName: string;
  title: string;
  subtitle?: string;
  tone: DashboardActivityTone;
};
