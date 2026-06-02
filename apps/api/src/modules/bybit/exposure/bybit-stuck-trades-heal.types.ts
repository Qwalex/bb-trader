export type StuckTradesHealResult = {
  ok: boolean;
  skipped: boolean;
  skipReason?: string;
  scanned: number;
  attempted: number;
  healed: number;
  details: Array<{
    signalId: string;
    pair: string;
    ok: boolean;
    complete: boolean;
    message: string;
  }>;
};

export type StuckTradesHealSettings = {
  enabled: boolean;
  intervalMs: number;
  maxPerRun: number;
  cooldownMs: number;
  deferBackoffMs: number;
};
