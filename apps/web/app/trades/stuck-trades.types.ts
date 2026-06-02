export type StuckTradeIssueKind = 'entry_db_stale' | 'missing_sl' | 'missing_tp';

export type StuckTradeIssue = {
  kind: StuckTradeIssueKind;
  message: string;
};

export type StuckTradeItem = {
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

export type StuckTradesSnapshot = {
  bybitConnected: boolean;
  scannedAt: string;
  pollStuck: boolean;
  pollLockedSince: string | null;
  items: StuckTradeItem[];
};

export function stuckIssuesBySignalId(
  items: StuckTradeItem[],
): Record<string, StuckTradeIssue[]> {
  const out: Record<string, StuckTradeIssue[]> = {};
  for (const item of items) {
    out[item.signalId] = item.issues;
  }
  return out;
}
