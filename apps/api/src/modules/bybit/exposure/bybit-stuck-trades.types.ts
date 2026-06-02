export type StuckTradeIssueKind = 'entry_db_stale' | 'missing_sl' | 'missing_tp';

export type StuckTradeIssue = {
  kind: StuckTradeIssueKind;
  message: string;
};

export type StuckTradeItemDto = {
  signalId: string;
  pair: string;
  direction: string;
  status: string;
  source: string | null;
  createdAt: string;
  positionSize: number;
  issues: StuckTradeIssue[];
  summary: string;
};

export type StuckTradesSnapshotDto = {
  bybitConnected: boolean;
  scannedAt: string;
  /** poll-cabinet завис в running дольше порога */
  pollStuck: boolean;
  pollLockedSince: string | null;
  items: StuckTradeItemDto[];
};
