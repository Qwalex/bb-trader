import type { SignalOrderOrigin } from '../../bybit/types/bybit.types';

export type SpotFlowPhase = 'awaiting_spot_decision' | 'awaiting_spot_amount';

export type SpotFlowSession = {
  ingestId: string;
  cabinetId: string;
  signal: import('@repo/shared').SignalDto;
  rawMessage?: string;
  origin?: SignalOrderOrigin;
  phase: SpotFlowPhase;
  userId?: number;
  expiresAt: number;
};

export type SpotSellSession = {
  signalId: string;
  pair: string;
  kind: 'tp' | 'sl';
  levelIndex: number;
  limitPrice: number;
  expiresAt: number;
};

export type SpotLevelHitNotify = {
  signalId: string;
  pair: string;
  kind: 'tp' | 'sl';
  levelIndex: number;
  levelPrice: number;
  lastPrice: number;
};
